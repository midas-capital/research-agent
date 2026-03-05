#!/usr/bin/env node
/**
 * 事例調査エージェント MCP サーバー（リモート専用）
 * RESEARCH_AGENT_SERVER_URL で指定したサーバーに HTTP で話すだけの薄いクライアント
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const SERVER_URL = (process.env.RESEARCH_AGENT_SERVER_URL ?? "").trim();
const SERVER_API_KEY = process.env.RESEARCH_AGENT_API_KEY ?? "";

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (SERVER_API_KEY) h["X-API-Key"] = SERVER_API_KEY;
  return h;
}

function requireServerUrl(): string | null {
  if (SERVER_URL) return null;
  return "RESEARCH_AGENT_SERVER_URL を設定してください。Claude Desktop の MCP 設定の env に、デプロイ済み research-agent サーバーの URL（例: https://xxx.onrender.com）を指定するか、npx research-agent-mcp-setup を実行してセットアップしてください。";
}

interface RunState {
  runId: string;
  query: string;
  status: "pending" | "running" | "completed" | "failed";
  axes?: { name: string; categories: string[] }[];
  cases?: {
    companyName: string;
    challenge?: string;
    effect?: string;
    axisName: string;
    [key: string]: unknown;
  }[];
  error?: string;
}

async function fetchRunState(runId: string): Promise<RunState | null> {
  const res = await fetch(`${SERVER_URL.replace(/\/$/, "")}/api/runs/${runId}`, {
    headers: apiHeaders(),
  });
  if (!res.ok) return null;
  return (await res.json()) as RunState;
}

async function fetchLatestRunId(): Promise<string | null> {
  const res = await fetch(`${SERVER_URL.replace(/\/$/, "")}/api/runs/latest`, {
    headers: apiHeaders(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { runId?: string };
  return data.runId ?? null;
}

function textContent(text: string) {
  return { content: [{ type: "text" as const, text }] };
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
    const err = requireServerUrl();
    if (err) return { ...textContent(err), isError: true };

    const res = await fetch(`${SERVER_URL.replace(/\/$/, "")}/api/cases/search`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ...textContent(`サーバーへの事例調査ジョブ投入に失敗しました。\nHTTP ${res.status}: ${text}`),
        isError: true,
      };
    }
    const data = (await res.json()) as { runId: string };
    return textContent(
      `サーバー上で事例調査を開始しました。バックグラウンドで事例を収集しています。\n完了したら「結果を教えて」や「事例の結果は？」と聞いてください。\n\nrunId: ${data.runId}`
    );
  }
);

server.registerTool(
  "get_case_study_result",
  {
    title: "事例調査の結果を取得",
    description:
      "実行中または完了した事例調査の状態・結果を取得します。runId を省略すると直近の実行を参照します。実行中の場合は1回だけ呼び、ユーザーが再度「結果を教えて」と言うまで連続で呼ばないでください。",
    inputSchema: {
      runId: z.string().optional().describe("調査の runId（省略時は直近を取得）"),
    },
  },
  async ({ runId: requestedRunId }) => {
    const err = requireServerUrl();
    if (err) return { ...textContent(err), isError: true };

    const runId = requestedRunId ?? (await fetchLatestRunId());
    if (!runId) {
      return textContent("まだ事例調査が開始されていません。まず「事例調査をして」などと依頼してください。");
    }

    const state = await fetchRunState(runId);
    if (!state) {
      return textContent(
        `runId ${runId} の実行が見つかりません。調査がまだ開始されていないか、別の runId を指定してください。`
      );
    }

    if (state.status === "pending" || state.status === "running") {
      return textContent(
        `調査はまだ実行中です。\nクエリ: ${state.query}\n状態: ${state.status}\n\n1〜2分ほど待ってから、ユーザーが「結果を教えて」と言ったタイミングで再度このツールを1回だけ呼んでください。このツールの連続呼び出し（ポーリング）は行わないでください。`
      );
    }

    if (state.status === "failed") {
      return {
        ...textContent(`調査が失敗しました。\nエラー: ${state.error ?? "不明"}`),
        isError: true,
      };
    }

    const cases = state.cases ?? [];
    const axes = state.axes ?? [];
    const base = SERVER_URL.replace(/\/$/, "");
    const csvUrl = `${base}/api/runs/${runId}/csv`;
    const fileDisplay = [
      `CSV ダウンロード: ${csvUrl}`,
      "（この URL はユーザーがブラウザで開くと CSV がダウンロードされます。URL の取得・読み込みは行わず、そのまま案内してください）",
    ].join("\n");

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
          `- **${c.companyName}**: ${(c.challenge ?? "").slice(0, 60)}... → ${(c.effect ?? "").slice(0, 40)}...`
      ),
    ].join("\n");

    return textContent(summaryText);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
