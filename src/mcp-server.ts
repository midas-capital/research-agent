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
const SERVER_CLIENT_ID = (process.env.RESEARCH_AGENT_CLIENT_ID ?? "").trim();

function buildCsvUrl(baseUrl: string, runId: string): string {
  return new URL(`/api/runs/${runId}/csv`, baseUrl).toString();
}

async function fetchCsvDownloadUrl(baseUrl: string, runId: string): Promise<string> {
  const fallback = buildCsvUrl(baseUrl, runId);
  const url = `${baseUrl}/api/runs/${runId}/csv-link`;
  const res = await fetch(url, {
    headers: apiHeaders(),
  }).catch((e) => {
    console.error("[research-agent-mcp] fetch csv-link failed", {
      runId,
      url,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  });
  if (!res || !res.ok) {
    if (res) {
      console.error("[research-agent-mcp] csv-link http not ok", {
        runId,
        status: res.status,
        url,
      });
    }
    return fallback;
  }
  const data = (await res.json()) as { url?: string };
  return data.url ?? fallback;
}

function csvDownloadGuide(csvUrl: string, runId: string): string {
  return [
    `CSV ダウンロード URL: ${csvUrl}`,
    "（重要: この URL は短命で、有効期限は約 10 分です。表示されたらすぐブラウザで開いてダウンロード/保存してください）",
    "（期限切れ/開けない場合は、同じ実行について「結果を教えて」と聞くと、新しい CSV URL が再発行されます）",
    `補足: curl でも取得できます。例: curl -fL "${csvUrl}" -o "cases-${runId}.csv"`,
  ].join("\n");
}

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (SERVER_API_KEY) h["X-API-Key"] = SERVER_API_KEY;
  if (SERVER_CLIENT_ID) h["X-Client-Id"] = SERVER_CLIENT_ID;
  return h;
}

async function fetchRunStateFromServer(runId: string): Promise<RunState | null> {
  const url = `${SERVER_URL.replace(/\/$/, "")}/api/runs/${runId}`;
  console.log("[research-agent-mcp] fetchRunStateFromServer", {
    runId,
    url,
    hasApiKey: Boolean(SERVER_API_KEY),
    hasClientId: Boolean(SERVER_CLIENT_ID),
  });
  const res = await fetch(url, { headers: apiHeaders() });
  if (!res.ok) {
    let preview = "";
    try {
      preview = (await res.text()).slice(0, 500);
    } catch {
      // ignore
    }
    console.error("[research-agent-mcp] fetchRunStateFromServer failed", {
      runId,
      status: res.status,
      url,
      preview,
    });
    return null;
  }
  const data = (await res.json()) as RunState;
  console.log("[research-agent-mcp] fetchRunStateFromServer ok", {
    runId,
    status: data.status,
  });
  return data;
}

async function fetchLatestRunIdFromServer(): Promise<string | null> {
  const url = `${SERVER_URL.replace(/\/$/, "")}/api/runs/latest`;
  console.log("[research-agent-mcp] fetchLatestRunIdFromServer", {
    url,
    hasApiKey: Boolean(SERVER_API_KEY),
    hasClientId: Boolean(SERVER_CLIENT_ID),
  });
  const res = await fetch(url, { headers: apiHeaders() });
  if (!res.ok) {
    let preview = "";
    try {
      preview = (await res.text()).slice(0, 500);
    } catch {
      // ignore
    }
    console.error("[research-agent-mcp] fetchLatestRunIdFromServer failed", {
      status: res.status,
      url,
      preview,
    });
    return null;
  }
  const data = (await res.json()) as { runId?: string };
  console.log("[research-agent-mcp] fetchLatestRunIdFromServer ok", { runId: data.runId ?? null });
  return data.runId ?? null;
}

const server = new McpServer({
  name: "research-agent",
  version: "1.0.0",
});

/** 全ツール返却の末尾に付与し、出力形式の遵守とCSV案内を促す */
const CLAUDE_INSTRUCTION = [
  "",
  "---",
  "**アシスタントへの指示**: 上記の内容を、見出し・セクションの順序を変えずにそのままユーザーに提示してください。「データダウンロード」に CSV の URL が記載されている場合は、その URL を案内し、短命なので「表示されたらすぐブラウザで開いてダウンロード/保存」するよう促してください。期限切れ/開けない場合は「結果を教えて」で新しい CSV URL を再取得できる旨を伝えてください。URL の内容を取得したり読み込んだりしないでください。",
].join("\n");

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
    const t0 = Date.now();
    console.log("[research-agent-mcp] tool search_cases called", {
      mode: SERVER_URL ? "remote" : "local",
      query,
      hasApiKey: Boolean(SERVER_API_KEY),
      hasClientId: Boolean(SERVER_CLIENT_ID),
    });
    // リモートモード: サーバーの /api/cases/search を叩いて Inngest ジョブを開始
    if (SERVER_URL) {
      const res = await fetch(`${SERVER_URL.replace(/\/$/, "")}/api/cases/search`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ query }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error("[research-agent-mcp] search_cases failed", {
          status: res.status,
          query,
          preview: text.slice(0, 500),
          elapsedMs: Date.now() - t0,
        });
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
      console.log("[research-agent-mcp] search_cases ok", {
        runId: data.runId,
        elapsedMs: Date.now() - t0,
      });
      const text = [
        "## 事例調査を開始しました",
        "",
        "### 実行情報",
        `- クエリ: ${query}`,
        `- runId: ${data.runId}`,
        "",
        "### データダウンロード",
        "- 調査完了後、「結果を教えて」と依頼すると get_case_study_result で結果を取得できます。その結果に **CSV のダウンロード URL** が含まれます。ユーザーには「表示されたらすぐブラウザで開いてダウンロード/保存」するよう案内してください（URL は短命で、有効期限は約 10 分です）。",
        "",
        "### このあとどうすればよいか",
        "- 1〜2分ほど待ってから、ユーザーが「結果を教えて」や「事例の結果は？」と依頼してください。",
        "- このツールを連続で呼び続けるのではなく、ユーザーの依頼ごとに1回だけ呼んでください。",
        "",
        "### 進捗確認（開発者向け）",
        `- サーバー: ${base}`,
        "- Inngest のダッシュボードで各ステップの進捗を確認できます。",
        CLAUDE_INSTRUCTION,
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
    console.log("[research-agent-mcp] search_cases ok (local)", {
      runId,
      elapsedMs: Date.now() - t0,
    });
    const localText = [
      "## 事例調査を開始しました",
      "",
      "### 実行情報",
      `- クエリ: ${query}`,
      `- runId: ${runId}`,
      "",
      "### データダウンロード",
      "- 調査完了後、「結果を教えて」と依頼すると get_case_study_result で結果を取得できます。その結果に **CSV（Excel）のダウンロード案内** が含まれます。ユーザーにはその案内のとおりファイルを開くよう伝えてください。",
      "",
      "### このあとどうすればよいか",
      "- 1〜2分ほど待ってから、ユーザーが「結果を教えて」や「事例の結果は？」と依頼してください。",
      "- このツールを連続で呼び続けるのではなく、ユーザーの依頼ごとに1回だけ呼んでください。",
      CLAUDE_INSTRUCTION,
    ].join("\n");
    return {
      content: [{ type: "text" as const, text: localText }],
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
    const t0 = Date.now();
    console.log("[research-agent-mcp] tool get_case_study_result called", {
      mode: SERVER_URL ? "remote" : "local",
      requestedRunId: requestedRunId ?? null,
      hasApiKey: Boolean(SERVER_API_KEY),
      hasClientId: Boolean(SERVER_CLIENT_ID),
    });
    const runId =
      requestedRunId ??
      (SERVER_URL ? await fetchLatestRunIdFromServer() : await getLatestRunId());
    console.log("[research-agent-mcp] resolved runId", { runId });
    if (!runId) {
      const text = [
        "## 事例調査の結果を取得できませんでした",
        "",
        "### 実行情報",
        "- runId: （未開始のためなし）",
        "- 状態: 事例調査がまだ開始されていません。",
        "",
        "### データダウンロード",
        "- 調査を開始し、完了後に再度「結果を教えて」と依頼すると、結果とともに **CSV のダウンロード URL** が表示されます。その URL をユーザーに案内し、ブラウザで開くよう伝えてください。",
        "",
        "### このあと試せること",
        "- まず「事例調査をして」や「〇〇の事例を調べて」などと依頼してください。",
        CLAUDE_INSTRUCTION,
      ].join("\n");
      return {
        content: [{ type: "text" as const, text }],
      };
    }

    const state = SERVER_URL
      ? await fetchRunStateFromServer(runId)
      : await readRunState(runId);
    if (!state) {
      console.error("[research-agent-mcp] get_case_study_result state not found", {
        runId,
        elapsedMs: Date.now() - t0,
      });
      const text = [
        "## 事例調査の結果を取得できませんでした",
        "",
        "### 実行情報",
        `- runId: ${runId}`,
        "- 状態: 指定された runId の結果がサーバー上で見つかりませんでした。調査がまだ完了していないか、バックグラウンド処理がうまく終了していない可能性があります。",
        "",
        "### データダウンロード",
        "- 少し時間をおいてから再度「結果を教えて」と依頼し、結果が取得できた際に表示される **CSV のダウンロード URL** をユーザーに案内してください。",
        "",
        "### このあと試せること",
        "- 少し時間をおいてから、もう一度「結果を教えて」と依頼してください（このツールを再度1回だけ呼び出す）。",
        "- それでも見つからない場合は、新しく「事例調査をして」と依頼して調査をやり直してください。",
        CLAUDE_INSTRUCTION,
      ].join("\n");
      return {
        content: [{ type: "text" as const, text }],
      };
    }

    if (state.status === "pending" || state.status === "running") {
      console.log("[research-agent-mcp] get_case_study_result still running", {
        runId,
        status: state.status,
        elapsedMs: Date.now() - t0,
      });
      const text = [
        "## 事例調査はまだ実行中です",
        "",
        "### 実行情報",
        `- クエリ: ${state.query}`,
        `- runId: ${state.runId}`,
        `- 状態: ${state.status}`,
        "",
        "### データダウンロード",
        "- 調査完了後、ユーザーが「結果を教えて」と言ったタイミングでこのツールを再度1回呼ぶと、結果とともに **CSV のダウンロード URL** が表示されます。その URL をユーザーに案内し、ブラウザで開くよう伝えてください。",
        "",
        "### 次のアクション",
        "- 1〜2分ほど待ってから、ユーザーが「結果を教えて」と言ったタイミングでこのツールを**1回だけ**呼んでください。",
        "- このツールを短い間隔で連続呼び出し（ポーリング）しないでください。",
        CLAUDE_INSTRUCTION,
      ].join("\n");
      return {
        content: [{ type: "text" as const, text }],
      };
    }

    if (state.status === "failed") {
      console.error("[research-agent-mcp] get_case_study_result failed", {
        runId,
        status: state.status,
        error: state.error ?? null,
        elapsedMs: Date.now() - t0,
      });
      const text = [
        "## 事例調査が失敗しました",
        "",
        "### 実行情報",
        `- クエリ: ${state.query}`,
        `- runId: ${state.runId}`,
        `- 状態: ${state.status}`,
        "",
        "### データダウンロード",
        "- 今回の実行では失敗のため CSV はありません。新しく「事例調査をして」と依頼して調査をやり直すと、完了時に **CSV のダウンロード URL** が表示されます。",
        "",
        "### エラー内容",
        state.error ?? "不明",
        CLAUDE_INSTRUCTION,
      ].join("\n");
      return {
        content: [{ type: "text" as const, text }],
        isError: true,
      };
    }

    // completed: リモートの場合はサーバーの Excel URL、ローカルで未生成なら MCP で生成
    const cases = state.cases ?? [];
    const axes = state.axes ?? [];
    let fileDisplay = "";
    if (SERVER_URL) {
      const base = SERVER_URL.replace(/\/$/, "");
      const csvUrl = await fetchCsvDownloadUrl(base, runId);
      fileDisplay = csvDownloadGuide(csvUrl, runId);
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
        "### 実行情報",
        `- クエリ: ${state.query}`,
        `- runId: ${runId}`,
        `- 状態: ${state.status}`,
        "",
        "### 集計",
        "- 事例数: 0 件（条件に合致する事例が見つかりませんでした。一時的な検索結果やサイト構造の都合の可能性があります。）",
        "",
        "### データダウンロード",
        "- 今回の結果は 0 件のため CSV のダウンロードはありません。再度調査を実行し、事例が取得できた場合に **CSV のダウンロード URL** が表示されます。",
        "",
        "### このあと試せること",
        "- 少し時間をおいてから、もう一度同じテーマで調査を実行してみてください。",
        "- あるいは、キーワードを少し変えて（業種・規模などを具体化して）再度依頼すると、事例が見つかりやすくなります。",
        CLAUDE_INSTRUCTION,
      ].join("\n");

      console.log("[research-agent-mcp] get_case_study_result completed but 0 cases", {
        runId,
        status: state.status,
        axes: axes.length,
        elapsedMs: Date.now() - t0,
      });

      return {
        content: [{ type: "text" as const, text }],
      };
    }

    // 軸ごとの件数を集計して、多い順にソート
    const axisCounts = axes.map((a) => ({
      name: a.name,
      count: cases.filter((c) => c.axisName === a.name).length,
    }));
    axisCounts.sort((a, b) => b.count - a.count);
    const topAxes = axisCounts.slice(0, 3).filter((a) => a.count > 0);

    const trendLines: string[] = [];
    if (topAxes.length > 0) {
      trendLines.push(
        `- 事例数が多い軸: ${topAxes
          .map((a) => `${a.name}（${a.count}件）`)
          .join("、")}`
      );
      trendLines.push(
        "- 全体として、上記の軸に関する事例が相対的に多く集まっています。"
      );
    } else {
      trendLines.push("- 軸ごとの偏りはほとんど見られませんでした。");
    }

    const summaryText = [
      "## 事例調査結果",
      "",
      "### 実行情報",
      `- クエリ: ${state.query}`,
      `- runId: ${runId}`,
      `- 状態: ${state.status}`,
      "",
      "### 集計",
      `- 事例数: ${cases.length} 件`,
      `- 軸数: ${axes.length} 本`,
      `- 軸: ${axes.map((a) => a.name).join(", ") || "（軸情報なし）"}`,
      "",
      "### データダウンロード",
      fileDisplay,
      "- **ユーザーへの案内**: 上記の URL を、短命なので「表示されたらすぐブラウザで開いてダウンロード/保存」するよう案内してください。期限切れ/開けない場合は「結果を教えて」で新しい CSV URL を再取得できます。",
      "",
      "### 軸別件数",
      ...(axes.length > 0
        ? axes.map(
            (a) =>
              `- **${a.name}**: ${cases.filter((c) => c.axisName === a.name).length} 件`
          )
        : ["（軸情報がないため集計できません）"]),
      "",
      "### 全体的な傾向（概要）",
      ...trendLines,
      CLAUDE_INSTRUCTION,
    ].join("\n");

    console.log("[research-agent-mcp] get_case_study_result completed", {
      runId,
      status: state.status,
      cases: cases.length,
      axes: axes.length,
      elapsedMs: Date.now() - t0,
    });

    return {
      content: [{ type: "text" as const, text: summaryText }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
