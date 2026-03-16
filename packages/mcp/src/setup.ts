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

const MANUAL_CONFIG = `
手動で設定する場合:
1. Claude Desktop を開く → 設定 → Developer → Edit config
2. mcpServers に以下を追加（既存のキーはそのままにしてください）:

  "research-agent": {
    "command": "npx",
    "args": ["research-agent-mcp"],
    "env": {
      "RESEARCH_AGENT_SERVER_URL": "https://あなたのサーバーURL",
      "RESEARCH_AGENT_API_KEY": "サーバーがAPIキーを要求する場合のみ"
    }
  }

3. Claude Desktop を再起動してください。
`;

async function main(): Promise<void> {
  const urlFromArg = process.argv.find((a) => a.startsWith("--url="))?.slice("--url=".length);
  const apiKeyFromArg = process.argv.find((a) => a.startsWith("--api-key="))?.slice("--api-key=".length);

  let serverUrl = urlFromArg?.trim() ?? "";
  let apiKey = apiKeyFromArg?.trim() ?? "";

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
    rl.close();
  }

  if (!serverUrl.startsWith("http://") && !serverUrl.startsWith("https://")) {
    serverUrl = "https://" + serverUrl;
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
