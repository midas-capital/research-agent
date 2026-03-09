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

/** 全ツール返却の末尾に付与し、出力形式の遵守とCSV案内を促す */
const CLAUDE_INSTRUCTION = [
  "",
  "---",
  "**アシスタントへの指示**: 上記の内容を、見出し・セクションの順序を変えずにそのままユーザーに提示してください。「データダウンロード」に CSV の URL が記載されている場合は、その URL をユーザーに案内し「ブラウザで開くと CSV がダウンロードできます」と伝えてください。URL の内容を取得したり読み込んだりしないでください。",
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
    const base = SERVER_URL.replace(/\/$/, "");
    const text = [
      "## 事例調査を開始しました",
      "",
      "### 実行情報",
      `- クエリ: ${query}`,
      `- runId: ${data.runId}`,
      "",
      "### データダウンロード",
      "- 調査完了後、「結果を教えて」と依頼すると get_case_study_result で結果を取得できます。その結果に **CSV のダウンロード URL** が含まれます。ユーザーにはその URL をブラウザで開くよう案内してください。",
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
    return textContent(text);
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
    const err = requireServerUrl();
    if (err) return { ...textContent(err), isError: true };

    const runId = requestedRunId ?? (await fetchLatestRunId());
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
      return textContent(text);
    }

    const state = await fetchRunState(runId);
    if (!state) {
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
      return textContent(text);
    }

    if (state.status === "pending" || state.status === "running") {
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
      return textContent(text);
    }

    if (state.status === "failed") {
      return {
        ...textContent(
          [
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
          ].join("\n")
        ),
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

      return textContent(text);
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
      "- **ユーザーへの案内**: 上記の URL をそのままユーザーに伝え、「このリンクをブラウザで開くと CSV がダウンロードできます」と説明してください。URL の内容を取得したり読み込んだりしないでください。",
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

    return textContent(summaryText);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
