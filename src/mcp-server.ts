#!/usr/bin/env node
/**
 * 事例調査エージェント MCP サーバー (stdio)
 * - ローカル: RESEARCH_AGENT_SERVER_URL 未設定 → ローカルファイル参照・Inngest はローカル
 * - リモート: RESEARCH_AGENT_SERVER_URL 設定時 → サーバー API で結果取得・Inngest は Cloud に送信
 */
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { inngest } from "./inngest/client.js";
import { readRunState, writeRunState, getLatestRunId } from "./lib/run-store.js";
import { writeExcel } from "./lib/excel.js";
import type { RunState } from "./types.js";

const SERVER_URL = process.env.RESEARCH_AGENT_SERVER_URL ?? "";
const SERVER_API_KEY = process.env.RESEARCH_AGENT_API_KEY ?? "";

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (SERVER_API_KEY) h["X-API-Key"] = SERVER_API_KEY;
  return h;
}

async function fetchRunStateFromServer(runId: string): Promise<RunState | null> {
  const res = await fetch(`${SERVER_URL.replace(/\/$/, "")}/api/runs/${runId}`, {
    headers: apiHeaders(),
  });
  if (!res.ok) return null;
  return (await res.json()) as RunState;
}

async function fetchLatestRunIdFromServer(): Promise<string | null> {
  const res = await fetch(`${SERVER_URL.replace(/\/$/, "")}/api/runs/latest`, {
    headers: apiHeaders(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { runId?: string };
  return data.runId ?? null;
}

const server = new McpServer({
  name: "research-agent",
  version: "1.0.0",
});

server.registerTool(
  "search_cases",
  {
    title: "事例調査を開始",
    description:
      "ユーザーの質問・テーマに基づいて事例調査を開始します。バックグラウンドで検索・選別・構造化が実行され、完了後に結果を取得できます。",
    inputSchema: {
      query: z.string().describe("調査したいテーマ・質問（例: 製造業のDX導入事例）"),
    },
  },
  async ({ query }) => {
    // リモートモード: サーバーの /api/cases/search を叩いて Inngest ジョブを開始
    if (SERVER_URL) {
      const res = await fetch(`${SERVER_URL.replace(/\/$/, "")}/api/cases/search`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ query }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          content: [
            {
              type: "text" as const,
              text: `サーバーへの事例調査ジョブ投入に失敗しました。\nHTTP ${res.status}: ${text}`,
            },
          ],
          isError: true,
        };
      }
      const data = (await res.json()) as { runId: string };
      return {
        content: [
          {
            type: "text" as const,
            text: `サーバー上で事例調査を開始しました。バックグラウンドで事例を収集しています。\n完了したら「結果を教えて」や「事例の結果は？」と聞いてください。\n\nrunId: ${data.runId}`,
          },
        ],
      };
    }

    // ローカルモード: 直接 Inngest Dev へイベント送信
    const runId = randomUUID();
    await inngest.send({
      name: "cases/search",
      data: { runId, query },
    });
    return {
      content: [
        {
          type: "text" as const,
          text: `調査を開始しました。バックグラウンドで事例を収集しています。\n完了したら「結果を教えて」や「事例の結果は？」と聞いてください。\n\nrunId: ${runId}`,
        },
      ],
    };
  }
);

server.registerTool(
  "get_case_study_result",
  {
    title: "事例調査の結果を取得",
    description:
      "実行中または完了した事例調査の状態・結果を取得します。runId を省略すると直近の実行を参照します。",
    inputSchema: {
      runId: z.string().optional().describe("調査の runId（省略時は直近を取得）"),
    },
  },
  async ({ runId: requestedRunId }) => {
    const runId =
      requestedRunId ??
      (SERVER_URL ? await fetchLatestRunIdFromServer() : await getLatestRunId());
    if (!runId) {
      return {
        content: [
          {
            type: "text" as const,
            text: "まだ事例調査が開始されていません。まず「事例調査をして」などと依頼してください。",
          },
        ],
      };
    }

    const state = SERVER_URL
      ? await fetchRunStateFromServer(runId)
      : await readRunState(runId);
    if (!state) {
      return {
        content: [
          {
            type: "text" as const,
            text: `runId ${runId} の実行が見つかりません。調査がまだ開始されていないか、別の runId を指定してください。`,
          },
        ],
      };
    }

    if (state.status === "pending" || state.status === "running") {
      return {
        content: [
          {
            type: "text" as const,
            text: `調査はまだ実行中です。\nクエリ: ${state.query}\n状態: ${state.status}\nしばらくしてから再度「結果を教えて」と聞いてください。`,
          },
        ],
      };
    }

    if (state.status === "failed") {
      return {
        content: [
          {
            type: "text" as const,
            text: `調査が失敗しました。\nエラー: ${state.error ?? "不明"}`,
          },
        ],
        isError: true,
      };
    }

    // completed: リモートの場合はサーバーの Excel URL、ローカルで未生成なら MCP で生成
    const cases = state.cases ?? [];
    const axes = state.axes ?? [];
    let fileDisplay = "";
    if (SERVER_URL) {
      const base = SERVER_URL.replace(/\/$/, "");
      const csvUrl = `${base}/api/runs/${runId}/csv`;
      fileDisplay = [
        `CSV ダウンロード: ${csvUrl}`,
        "（この URL はユーザーがブラウザで開くと CSV がダウンロードされます。URL の取得・読み込みは行わず、そのまま案内してください）",
      ].join("\n");
    } else {
      let excelPath = state.excelPath ?? "";
      if (!excelPath && cases.length > 0 && axes.length > 0) {
        try {
          excelPath = await writeExcel(runId, axes, cases);
          await writeRunState({ ...state, excelPath });
        } catch (e) {
          console.error("Excel generation failed:", e);
        }
      }
      fileDisplay = excelPath ? `Excel: file://${excelPath}` : "（Excel は生成されていません）";
    }

    const summaryText = [
      `## 事例調査結果 (runId: ${runId})`,
      `クエリ: ${state.query}`,
      `事例数: ${cases.length} 件`,
      `軸: ${axes.map((a) => a.name).join(", ")}`,
      "",
      fileDisplay,
      "",
      "### サマリー（軸別）",
      ...axes.map(
        (a) =>
          `- **${a.name}**: ${cases.filter((c) => c.axisName === a.name).length} 件`
      ),
      "",
      "### 事例一覧（先頭10件）",
      ...cases.slice(0, 10).map(
        (c) =>
          `- **${c.companyName}**: ${c.challenge?.slice(0, 60) ?? ""}... → ${c.effect?.slice(0, 40) ?? ""}...`
      ),
    ].join("\n");

    return {
      content: [{ type: "text" as const, text: summaryText }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
