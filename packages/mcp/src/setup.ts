#!/usr/bin/env node
/**
 * research-agent-mcp の 1 コマンドセットアップ
 * Claude Desktop の設定ファイルに MCP を追加する
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

function getClaudeConfigPath(): string {
  const platform = process.platform;
  const homedir = os.homedir();
  if (platform === "darwin") {
    return path.join(homedir, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(homedir, "AppData", "Roaming");
    return path.join(appData, "Claude", "claude_desktop_config.json");
  }
  // Linux など
  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(homedir, ".config");
  return path.join(configHome, "Claude", "claude_desktop_config.json");
}

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve((answer ?? "").trim()));
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function verifyCredentials(
  baseUrl: string,
  apiKey: string,
  clientId: string
): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/verify`;
  const headers: Record<string, string> = {};
  if (apiKey) headers["X-API-Key"] = apiKey;
  if (clientId) headers["X-Client-Id"] = clientId;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers, signal: ac.signal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `サーバーに接続できませんでした（${msg}）。URL が正しいか、ネットワークを確認してください。`
    );
  } finally {
    clearTimeout(t);
  }

  if (res.ok) return;

  let detail = "";
  try {
    const j = (await res.json()) as { error?: string };
    if (j?.error) detail = j.error;
  } catch {
    /* ignore */
  }

  if (res.status === 401) {
    if (!apiKey) {
      throw new Error(
        "サーバーは API キーを要求しています。--api-key=... を付けて再実行するか、対話モードで API キーを入力してください。"
      );
    }
    if (detail.includes("Client") || detail.includes("client")) {
      throw new Error(
        "Client ID が不足しているか、サーバーと一致しません。--client-id=... を付けて再実行するか、管理者に確認してください。"
      );
    }
    throw new Error(
      "API キーがサーバーと一致しません。Render の RESEARCH_AGENT_API_KEY と同じ値を --api-key で指定してください。"
    );
  }

  throw new Error(`認証の確認に失敗しました (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
}

const MANUAL_CONFIG = `
手動で設定する場合:
1. Claude Desktop を開く → 設定 → Developer → Edit config
2. mcpServers に以下を追加（既存のキーはそのままにしてください）:

  "research-agent": {
    "command": "npx",
    "args": ["research-agent-mcp"],
    "env": {
      "RESEARCH_AGENT_SERVER_URL": "https://あなたのサーバーURL",
      "RESEARCH_AGENT_API_KEY": "サーバーがAPIキーを要求する場合のみ",
      "RESEARCH_AGENT_CLIENT_ID": "利用者を識別するID（サーバーで必須にしている場合のみ）"
    }
  }

3. Claude Desktop を再起動してください。
`;

async function main(): Promise<void> {
  console.log("=== research-agent-mcp-setup を開始します ===");
  console.log(`Node バージョン: ${process.version}`);
  console.log(`プラットフォーム: ${process.platform}`);
  console.log(`引数: ${process.argv.slice(2).join(" ") || "(なし)"}`);

  const skipVerify = process.argv.includes("--skip-verify");

  const urlFromArg = process.argv.find((a) => a.startsWith("--url="))?.slice("--url=".length);
  const apiKeyFromArg = process.argv.find((a) => a.startsWith("--api-key="))?.slice("--api-key=".length);
  const clientIdFromArg = process.argv.find((a) => a.startsWith("--client-id="))?.slice("--client-id=".length);

  let serverUrl = urlFromArg?.trim() ?? "";
  let apiKey = apiKeyFromArg?.trim() ?? "";
  let clientId = clientIdFromArg?.trim() ?? "";

  if (!serverUrl) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log("research-agent MCP のセットアップ\n");
    serverUrl = await question(
      rl,
      "デプロイ済み research-agent サーバーの URL を入力してください（例: https://xxx.onrender.com）: "
    );
    if (!serverUrl) {
      console.log("URL が入力されませんでした。セットアップを中止します。");
      rl.close();
      process.exit(1);
    }
    apiKey = await question(
      rl,
      "API キー（サーバーが要求する場合のみ。不要なら Enter）: "
    );
    clientId = await question(
      rl,
      "Client ID（利用者を識別するID。サーバーで必須の場合のみ。不要なら Enter）: "
    );
    rl.close();
    console.log("\n入力完了:");
    console.log(`- サーバー URL: ${serverUrl}`);
    console.log(`- API キー: ${apiKey ? "入力あり（値は表示しません）" : "未入力"}`);
    console.log(`- Client ID: ${clientId ? "入力あり（値は表示しません）" : "未入力"}`);
  } else {
    console.log("\nコマンドライン引数から設定を読み込みました:");
    console.log(`- サーバー URL: ${serverUrl}`);
    console.log(`- API キー: ${apiKey ? "引数で指定あり（値は表示しません）" : "指定なし"}`);
    console.log(`- Client ID: ${clientId ? "引数で指定あり（値は表示しません）" : "指定なし"}`);
  }

  if (!serverUrl.startsWith("http://") && !serverUrl.startsWith("https://")) {
    serverUrl = "https://" + serverUrl;
  }

  if (clientId && !UUID_RE.test(clientId)) {
    console.log(
      "\n注意: Client ID が UUID の形式ではありません。運用で UUID を使う場合は、uuidgen などで発行した値を指定してください。\n"
    );
  }

  if (!skipVerify) {
    console.log("\nサーバーで API キー・Client ID を確認しています...");
    try {
      await verifyCredentials(serverUrl, apiKey, clientId);
      console.log("認証設定はサーバー要件を満たしています。");
    } catch (e) {
      console.error("\n認証の確認に失敗しました:", e instanceof Error ? e.message : e);
      console.log("\nネットワークのみ確認したい場合は --skip-verify を付けて再実行できます（設定は未検証のまま書き込まれます）。");
      process.exit(1);
    }
  } else {
    console.log("\n--skip-verify のため、サーバーへの認証確認をスキップします。");
  }

  const configPath = getClaudeConfigPath();
  console.log(`\nClaude 設定ファイルのパス: ${configPath}`);
  let config: Record<string, unknown> = {};

  try {
    console.log("設定ファイルを読み込み中です...");
    const raw = await fs.readFile(configPath, "utf-8");
    config = JSON.parse(raw) as Record<string, unknown>;
    console.log("設定ファイルの読み込みが完了しました。");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      console.log(`設定ファイルが見つかりません: ${configPath}`);
      console.log("Claude Desktop を一度起動し、設定画面を開いたことがあればファイルが作成されます。");
      console.log(MANUAL_CONFIG);
      process.exit(1);
    }
    if (err?.code === "EACCES") {
      console.log("設定ファイルを読み込む権限がありません。");
      console.log(MANUAL_CONFIG);
      process.exit(1);
    }
    throw e;
  }

  const mcpEntry = {
    command: "npx",
    args: ["research-agent-mcp"],
    env: {
      RESEARCH_AGENT_SERVER_URL: serverUrl,
      ...(apiKey ? { RESEARCH_AGENT_API_KEY: apiKey } : {}),
      ...(clientId ? { RESEARCH_AGENT_CLIENT_ID: clientId } : {}),
    },
  };

  const mcpServers = (config.mcpServers && typeof config.mcpServers === "object" ? { ...config.mcpServers } : {}) as Record<string, unknown>;
  mcpServers["research-agent"] = mcpEntry;
  config.mcpServers = mcpServers;

  try {
    console.log("設定ファイルを書き込み中です...");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
    console.log("設定ファイルの書き込みが完了しました。");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    console.log("設定ファイルの書き込みに失敗しました:", err?.message ?? e);
    console.log(MANUAL_CONFIG);
    process.exit(1);
  }

  console.log("\n設定を追加しました。");
  console.log("Claude Desktop を再起動すると、事例調査 MCP が使えるようになります。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
