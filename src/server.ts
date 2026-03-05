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
import { serve } from "inngest/express";
import { inngest } from "./inngest/client.js";
import { caseStudySearch, caseStudySupplement } from "./inngest/functions/case-study.js";
import { readRunState, getLatestRunId } from "./lib/run-store.js";
import { initRunStatesTable } from "./lib/db.js";
import { config, getExcelPath } from "./config.js";

const app = express();
const port = Number(process.env.PORT) || 3000;
const apiKey = process.env.RESEARCH_AGENT_API_KEY ?? "";

function checkApiKey(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!apiKey) return next();
  const key = req.header("x-api-key") ?? req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (key === apiKey) return next();
  res.status(401).json({ error: "Invalid or missing API key" });
}

app.use(express.json());

// 事例調査ジョブを開始する API（サーバー側で Inngest にイベント送信）
app.post("/api/cases/search", checkApiKey, async (req, res) => {
  try {
    const query = String((req.body?.query ?? "") as string).trim();
    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }

    const runId = randomUUID();
    await inngest.send({
      name: "cases/search",
      data: { runId, query },
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
  res.json({ ok: true, service: "research-agent" });
});

// デプロイ用: 他端末の MCP が結果を取得
app.get("/api/runs/latest", checkApiKey, async (_req, res) => {
  try {
    const runId = await getLatestRunId();
    if (!runId) return res.status(404).json({ error: "No runs found" });
    res.json({ runId });
  } catch {
    res.status(404).json({ error: "No runs found" });
  }
});

app.get("/api/runs/:runId", checkApiKey, async (req, res) => {
  const runId = String(req.params.runId ?? "");
  const state = await readRunState(runId);
  if (!state) return res.status(404).json({ error: "Run not found" });
  res.json(state);
});

app.get("/api/runs/:runId/excel", checkApiKey, async (req, res) => {
  const runId = String(req.params.runId ?? "");
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
app.get("/api/runs/:runId/csv", checkApiKey, async (req, res) => {
  const runId = String(req.params.runId ?? "");
  const state = await readRunState(runId);
  if (!state || !state.cases) return res.status(404).json({ error: "Run not found" });

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
