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
      "「〇〇の事例を調べて」「成功事例を教えて」「ケーススタディをまとめて」「導入事例を一覧にして」など、事例・ケーススタディ調査を始めたいときに使うツールです。ユーザーの質問・テーマに基づいて、Web 上の導入事例・成功事例・活用事例・ケーススタディを検索し、バックグラウンドで選別・構造化を行います。完了後は get_case_study_result ツールで、事例のサマリーと CSV ダウンロード用リンクを取得できます。",
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
      const base = SERVER_URL.replace(/\/$/, "");
      const text = [
        "## 事例調査を開始しました",
        "",
        `- クエリ: ${query}`,
        `- runId: ${data.runId}`,
        "",
        "### このあとどうすればよいか",
        "- 1〜2分ほど待ってから、ユーザーが「結果を教えて」や「事例の結果は？」と依頼してください。",
        "- このツールを連続で呼び続けるのではなく、ユーザーの依頼ごとに1回だけ呼んでください。",
        "",
        "### 進捗確認（開発者向け）",
        `- サーバー: ${base}`,
        "- Inngest のダッシュボードで各ステップの進捗を確認できます。",
      ].join("\n");
      return {
        content: [
          {
            type: "text" as const,
            text,
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
      "「さっきの事例調査の結果を教えて」「事例リストを見せて」「ケーススタディの一覧を出して」など、事例調査の結果・レポートを確認したいときに使うツールです。実行中または完了した事例調査の状態と結果（サマリー・軸別件数・代表事例・CSV ダウンロード URL）を取得します。runId を省略すると直近の実行を参照します。実行中の場合は 1 回だけ呼び、ユーザーが再度「結果を教えて」と言うまで連続で呼ばないでください。",
    inputSchema: {
      runId: z.string().optional().describe("調査の runId（省略時は直近を取得）"),
    },
  },
  async ({ runId: requestedRunId }) => {
    const runId =
      requestedRunId ??
      (SERVER_URL ? await fetchLatestRunIdFromServer() : await getLatestRunId());
    if (!runId) {
      const text = [
        "## 事例調査の結果を取得できませんでした",
        "",
        "- まだ事例調査が開始されていないようです。",
        "- まず「事例調査をして」や「〇〇の事例を調べて」などと依頼してください。",
      ].join("\n");
      return {
        content: [
          {
            type: "text" as const,
            text,
          },
        ],
      };
    }

    const state = SERVER_URL
      ? await fetchRunStateFromServer(runId)
      : await readRunState(runId);
    if (!state) {
      const text = [
        "## 事例調査の結果を取得できませんでした",
        "",
        `- runId: ${runId}`,
        "- 指定された runId の結果がサーバー上で見つかりませんでした。",
        "- 調査がまだ完了していないか、バックグラウンド処理がうまく終了していない可能性があります。",
        "",
        "### このあと試せること",
        "- 少し時間をおいてから、もう一度「結果を教えて」と依頼してください（このツールを再度1回だけ呼び出す）。",
        "- それでも見つからない場合は、新しく「事例調査をして」と依頼して調査をやり直してください。",
      ].join("\n");
      return {
        content: [
          {
            type: "text" as const,
            text,
          },
        ],
      };
    }

    if (state.status === "pending" || state.status === "running") {
      const text = [
        "## 事例調査はまだ実行中です",
        "",
        `- クエリ: ${state.query}`,
        `- runId: ${state.runId}`,
        `- 状態: ${state.status}`,
        "",
        "### 次のアクション",
        "- 1〜2分ほど待ってから、ユーザーが「結果を教えて」と言ったタイミングでこのツールを**1回だけ**呼んでください。",
        "- このツールを短い間隔で連続呼び出し（ポーリング）しないでください。",
      ].join("\n");
      return {
        content: [
          {
            type: "text" as const,
            text,
          },
        ],
      };
    }

    if (state.status === "failed") {
      const text = [
        "## 事例調査が失敗しました",
        "",
        `- クエリ: ${state.query}`,
        `- runId: ${state.runId}`,
        "",
        `エラー内容: ${state.error ?? "不明"}`,
      ].join("\n");
      return {
        content: [
          {
            type: "text" as const,
            text,
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

    // 事例が1件もない場合は、調査がうまく完了していない可能性を案内
    if (!cases.length) {
      const text = [
        "## 事例調査の結果について",
        "",
        "- 実行は完了しましたが、条件に合致する事例が見つかりませんでした。",
        "- 一時的な検索結果やサイト構造の都合で、十分な事例を抽出できていない可能性もあります。",
        "",
        "### 実行情報",
        `- クエリ: ${state.query}`,
        `- runId: ${runId}`,
        `- 状態: ${state.status}`,
        "",
        "### このあと試せること",
        "- 少し時間をおいてから、もう一度同じテーマで調査を実行してみてください。",
        "- あるいは、キーワードを少し変えて（業種・規模などを具体化して）再度依頼すると、事例が見つかりやすくなります。",
      ].join("\n");

      return {
        content: [{ type: "text" as const, text }],
      };
    }

    const summaryText = [
      `## 事例調査結果`,
      "",
      "### 実行情報",
      `- クエリ: ${state.query}`,
      `- runId: ${runId}`,
      `- 状態: ${state.status}`,
      "",
      "### 集計",
      `- 事例数: ${cases.length} 件`,
      `- 軸: ${axes.map((a) => a.name).join(", ") || "（軸情報なし）"}`,
      "",
      "### データダウンロード",
      fileDisplay,
      "",
      "### 軸別件数",
      ...(axes.length > 0
        ? axes.map(
            (a) =>
              `- **${a.name}**: ${cases.filter((c) => c.axisName === a.name).length} 件`
          )
        : ["（軸情報がないため集計できません）"]),
      "",
      "### 代表事例（先頭10件）",
      ...(cases.length > 0
        ? cases.slice(0, 10).map(
            (c) =>
              `- **${c.companyName}**: ${(c.challenge ?? "").slice(0, 60)}... → ${(c.effect ?? "").slice(0, 40)}...`
          )
        : ["（事例がまだありません）"]),
    ].join("\n");

    return {
      content: [{ type: "text" as const, text: summaryText }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
