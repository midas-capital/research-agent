/**
 * Express + Inngest サーバー
 * - POST /api/inngest: Inngest がジョブを実行するエンドポイント
 * - GET /api/runs/*: デプロイ時、他端末の MCP が結果を取得する API
 */
import "dotenv/config";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { serve } from "inngest/express";
import { inngest } from "./inngest/client.js";
import { caseStudySearch, caseStudySupplement } from "./inngest/functions/case-study.js";
import { readRunState } from "./lib/run-store.js";
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
    const runsDir = path.join(config.dataDir, "runs");
    const files = await fs.readdir(runsDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    if (jsonFiles.length === 0) return res.status(404).json({ error: "No runs found" });
    const stats = await Promise.all(
      jsonFiles.map(async (f) => ({
        name: f.replace(/\.json$/, ""),
        mtime: (await fs.stat(path.join(runsDir, f))).mtimeMs,
      }))
    );
    stats.sort((a, b) => b.mtime - a.mtime);
    res.json({ runId: stats[0].name });
  } catch (err) {
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

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
  console.log("Inngest endpoint: http://localhost:%s/api/inngest", port);
});
