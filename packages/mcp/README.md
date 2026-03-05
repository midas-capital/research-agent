# research-agent-mcp

事例調査エージェント（research-agent）の MCP サーバーです。デプロイ済みの research-agent サーバーに接続し、Claude から「事例調査をして」「結果を教えて」と依頼できるようにします。

## 必要なもの

- **Node.js 18 以上**（`node -v` で確認）
- **デプロイ済み research-agent サーバーの URL**（誰かが共有している URL か、自分でデプロイしたサーバー）

## 簡単セットアップ（おすすめ）

1. ターミナルで次を実行:
   ```bash
   npx research-agent-mcp-setup
   ```
2. 表示に従って **サーバー URL** を入力（例: `https://xxx.onrender.com`）。API キーが必要なサーバーなら、同じタイミングで入力できます。
3. **Claude Desktop を再起動**する。

これで設定完了です。Claude で「〇〇の事例を調査して」と試せます。

### 非対話で設定する場合

```bash
npx research-agent-mcp-setup --url=https://your-app.onrender.com
# API キーが必要な場合
npx research-agent-mcp-setup --url=https://your-app.onrender.com --api-key=your-key
```

## 手動で設定する場合

1. Claude Desktop → 設定 → Developer → **Edit config** で `claude_desktop_config.json` を開く。
2. `mcpServers` に次を追加（既存の MCP がある場合はその中に `research-agent` を足す）:

```json
{
  "mcpServers": {
    "research-agent": {
      "command": "npx",
      "args": ["research-agent-mcp"],
      "env": {
        "RESEARCH_AGENT_SERVER_URL": "https://your-app.onrender.com",
        "RESEARCH_AGENT_API_KEY": "optional-if-server-requires"
      }
    }
  }
}
```

3. Claude Desktop を再起動する。

- **RESEARCH_AGENT_SERVER_URL**: 必須。research-agent サーバーの URL。
- **RESEARCH_AGENT_API_KEY**: サーバーが API キーを要求している場合のみ同じ値を設定。

## 使い方

- Claude に「製造業のDX事例を調査して」などと依頼 → 調査が開始される。
- 1〜2 分待ってから「結果を教えて」と依頼 → サマリーと CSV のダウンロード URL が返る。CSV は **ブラウザで URL を開くとダウンロード**されます。

## 制限

- このパッケージは **リモート専用** です。サーバー URL を指定してデプロイ済みサーバーに接続する前提です。
- ローカルでサーバーを立てずに開発・検証したい場合は、research-agent 本家リポジトリをクローンして `npm run mcp:dev` を使ってください。
