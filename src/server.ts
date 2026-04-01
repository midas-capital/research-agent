/**
 * Express + Inngest サーバー
 * - POST /api/inngest: Inngest がジョブを実行するエンドポイント
 * - GET /api/runs/*: デプロイ時、他端末の MCP が結果を取得する API
 */
import "dotenv/config";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import crypto from "node:crypto";
import { serve } from "inngest/express";
import { inngest } from "./inngest/client.js";
import { caseStudySearch, caseStudySupplement } from "./inngest/functions/case-study.js";
import { readRunState, getLatestRunId } from "./lib/run-store.js";
import { initRunStatesTable } from "./lib/db.js";
import { config, getExcelPath } from "./config.js";
import type { RunState } from "./types.js";

const app = express();
const port = Number(process.env.PORT) || 3000;
const apiKey = process.env.RESEARCH_AGENT_API_KEY ?? "";
const requireClientId = process.env.RESEARCH_AGENT_REQUIRE_CLIENT_ID === "true";

function checkApiKey(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!apiKey) return next();
  const key = req.header("x-api-key") ?? req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (key === apiKey) return next();
  res.status(401).json({ error: "Invalid or missing API key" });
}

function getClientId(req: express.Request): string | undefined {
  const h = req.header("x-client-id")?.trim();
  return h || undefined;
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function signPayload(payloadB64: string): string {
  return crypto.createHmac("sha256", apiKey).update(payloadB64).digest("base64url");
}

function makeDownloadToken(runId: string, clientId: string | undefined): string | null {
  if (!apiKey) return null;
  const payload = {
    runId,
    clientId: clientId ?? "",
    exp: Date.now() + 10 * 60 * 1000, // 10 minutes
  };
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const sig = signPayload(payloadB64);
  return `${payloadB64}.${sig}`;
}

function verifyDownloadToken(token: string | undefined, runId: string): { ok: boolean; clientId?: string } {
  if (!apiKey || !token) return { ok: false };
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return { ok: false };
  const expected = signPayload(payloadB64);
  if (sig !== expected) return { ok: false };
  try {
    const raw = Buffer.from(payloadB64, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as { runId?: string; clientId?: string; exp?: number };
    if (!parsed.runId || parsed.runId !== runId) return { ok: false };
    if (!parsed.exp || Date.now() > parsed.exp) return { ok: false };
    return { ok: true, clientId: parsed.clientId || undefined };
  } catch {
    return { ok: false };
  }
}

/** RESEARCH_AGENT_REQUIRE_CLIENT_ID=true のとき、保護ルートで X-Client-Id 必須 */
function checkClientIdRequired(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!requireClientId) return next();
  if (!getClientId(req)) {
    res.status(401).json({ error: "X-Client-Id header is required" });
    return;
  }
  next();
}

/** Run に owner がいる場合はヘッダと一致必須（不一致は 404） */
function canAccessRun(state: RunState, reqClientId: string | undefined): boolean {
  if (!state.ownerClientId) return true;
  if (!reqClientId) return false;
  return state.ownerClientId === reqClientId;
}

// Inngest の POST /api/inngest はステップ結果などを含むためペイロードが大きくなりやすい（デフォルト 100kb で Payload Too Large になる）
const jsonLimit = process.env.EXPRESS_JSON_LIMIT ?? "10mb";
app.use(express.json({ limit: jsonLimit }));

// 事例調査ジョブを開始する API（サーバー側で Inngest にイベント送信）
app.post("/api/cases/search", checkApiKey, checkClientIdRequired, async (req, res) => {
  try {
    const query = String((req.body?.query ?? "") as string).trim();
    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }

    const clientId = getClientId(req);

    const runId = randomUUID();
    await inngest.send({
      name: "cases/search",
      data: { runId, query, clientId: clientId ?? undefined },
    });

    res.status(202).json({ runId });
  } catch (err) {
    console.error("Failed to start case study search", err);
    res.status(500).json({ error: "Failed to start search" });
  }
});

app.use(
  "/api/inngest",
  serve({
    client: inngest,
    functions: [caseStudySearch, caseStudySupplement],
  })
);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "research-agent",
    /** MCP セットアップがプロンプトを出し分けするためのヒント（認証不要） */
    requireApiKey: !!apiKey.trim(),
    requireClientId,
  });
});

/**
 * MCP セットアップ時の認証確認用。他 API と同じ checkApiKey / checkClientIdRequired を通す。
 * 200 = 送った X-API-Key / X-Client-Id がサーバー要件を満たす（キーはサーバー側の値と一致）。
 */
app.get("/api/verify", checkApiKey, checkClientIdRequired, (_req, res) => {
  res.json({
    ok: true,
    requireClientId,
  });
});

// デプロイ用: 他端末の MCP が結果を取得（X-Client-Id がある場合はその利用者の最新のみ）
app.get("/api/runs/latest", checkApiKey, checkClientIdRequired, async (req, res) => {
  try {
    const runId = await getLatestRunId(getClientId(req));
    if (!runId) return res.status(404).json({ error: "No runs found" });
    res.json({ runId });
  } catch {
    res.status(404).json({ error: "No runs found" });
  }
});

app.get("/api/runs/:runId", checkApiKey, checkClientIdRequired, async (req, res) => {
  const runId = String(req.params.runId ?? "");
  const state = await readRunState(runId);
  if (!state) return res.status(404).json({ error: "Run not found" });
  if (!canAccessRun(state, getClientId(req))) {
    return res.status(404).json({ error: "Run not found" });
  }
  res.json(state);
});

app.get("/api/runs/:runId/csv-link", checkApiKey, checkClientIdRequired, async (req, res) => {
  const runId = String(req.params.runId ?? "");
  const state = await readRunState(runId);
  const reqClientId = getClientId(req);
  if (!state || !state.cases || !canAccessRun(state, reqClientId)) {
    return res.status(404).json({ error: "Run not found" });
  }
  const base = `${req.protocol}://${req.get("host")}`;
  const token = makeDownloadToken(runId, reqClientId);
  const url = token
    ? `${base}/api/runs/${runId}/csv?downloadToken=${encodeURIComponent(token)}`
    : `${base}/api/runs/${runId}/csv`;
  res.json({ url, expiresInSec: token ? 600 : null });
});

app.get("/api/runs/:runId/excel", checkApiKey, checkClientIdRequired, async (req, res) => {
  const runId = String(req.params.runId ?? "");
  const state = await readRunState(runId);
  if (!state || !canAccessRun(state, getClientId(req))) {
    return res.status(404).json({ error: "Excel not found" });
  }
  const excelPath = getExcelPath(runId);
  try {
    await fs.access(excelPath);
  } catch {
    return res.status(404).json({ error: "Excel not found" });
  }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="cases-${runId}.xlsx"`);
  const buf = await fs.readFile(excelPath);
  res.send(buf);
});

// CSV をその場で生成して返す API（全事例シート相当）
app.get("/api/runs/:runId/csv", async (req, res) => {
  const runId = String(req.params.runId ?? "");
  const token =
    typeof req.query.downloadToken === "string" ? req.query.downloadToken : undefined;
  const verified = verifyDownloadToken(token, runId);

  if (verified.ok) {
    // downloadToken 経由のときは、内部的に clientId ヘッダ扱いでアクセス制御する
    if (verified.clientId) req.headers["x-client-id"] = verified.clientId;
    if (!verified.clientId) delete req.headers["x-client-id"];
  }

  if (!verified.ok && apiKey) {
    const key = req.header("x-api-key") ?? req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (key !== apiKey) return res.status(401).json({ error: "Invalid or missing API key" });
    if (requireClientId && !getClientId(req)) {
      return res.status(401).json({ error: "X-Client-Id header is required" });
    }
  }

  const state = await readRunState(runId);
  if (!state || !state.cases) return res.status(404).json({ error: "Run not found" });
  if (!canAccessRun(state, getClientId(req))) {
    return res.status(404).json({ error: "Run not found" });
  }

  const header = [
    "axis",
    "category",
    "company",
    "challenge",
    "solution",
    "effect",
    "url",
    "duplicate",
  ];

  const escape = (value: string | undefined): string => {
    const v = (value ?? "").replace(/"/g, '""');
    return `"${v}"`;
  };

  const rows = state.cases.map((c) =>
    [
      escape(c.axisName),
      escape(c.categoryName),
      escape(c.companyName),
      escape(c.challenge),
      escape(c.solution),
      escape(c.effect),
      escape(c.url),
      escape((c as any).duplicateOf ? "duplicate" : ""),
    ].join(",")
  );

  const csv = [header.join(","), ...rows].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="cases-${runId}.csv"`);
  res.send(csv);
});

(async () => {
  await initRunStatesTable();
  app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
    console.log("Inngest endpoint: http://localhost:%s/api/inngest", port);
  });
})();
