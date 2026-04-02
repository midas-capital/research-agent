# research-agent-mcp

**npm バージョン: latest 推奨**（固定版を使う場合は [package.json](./package.json) の `version` と同期）

事例調査エージェント（research-agent）の MCP サーバーです。デプロイ済みの research-agent サーバーに接続し、Claude から「事例調査をして」「結果を教えて」と依頼できるようにします。

## 必要なもの

- **Node.js 18 以上**（`node -v` で確認）
- **デプロイ済み research-agent サーバーの URL**（誰かが共有している URL か、自分でデプロイしたサーバー）

## 簡単セットアップ（おすすめ）

1. ターミナルで次を実行（**常に最新版を使用**）:
   ```bash
   npx -y --package=research-agent-mcp@latest -- research-agent-mcp-setup --url=https://research-agent-wpx8.onrender.com
   ```
2. 表示に従って **サーバー URL** を入力（例: `https://xxx.onrender.com`）。続けて **GET /health** でサーバー要件を確認し、必要なら **API キー**、**Client ID** を順に聞かれます。`--url=...` だけ付けて実行した場合も、未入力分だけ順に聞かれます。
3. **Claude Desktop を再起動**する。

これで設定完了です。Claude で「〇〇の事例を調査して」と試せます。

### 非対話で設定する場合

```bash
npx -y --package=research-agent-mcp@latest -- research-agent-mcp-setup --url=https://your-app.onrender.com
# API キーが必要な場合
npx -y --package=research-agent-mcp@latest -- research-agent-mcp-setup --url=https://your-app.onrender.com --api-key=your-key
# Client ID が必要な場合（サーバーで `RESEARCH_AGENT_REQUIRE_CLIENT_ID=true` で運用しているとき）
npx -y --package=research-agent-mcp@latest -- research-agent-mcp-setup --url=https://your-app.onrender.com --api-key=your-key --client-id=your-client-id
```

セットアップ時、**`GET /health`** で API キー／Client ID の要否を確認し、続けてデフォルトで **`GET /api/verify`** を呼び、サーバーに設定されている `RESEARCH_AGENT_API_KEY` と一致するか（および Client ID 必須時はヘッダが付くか）を確認します。オフラインなどで検証を飛ばす場合は `--skip-verify` を付けてください。

## 手動で設定する場合

1. Claude Desktop → 設定 → Developer → **Edit config** で `claude_desktop_config.json` を開く。
2. `mcpServers` に次を追加（既存の MCP がある場合はその中に `research-agent` を足す）:

```json
{
  "mcpServers": {
    "research-agent": {
      "command": "npx",
      "args": ["-y", "--package=research-agent-mcp@latest", "--", "research-agent-mcp"],
      "env": {
        "RESEARCH_AGENT_SERVER_URL": "https://your-app.onrender.com",
        "RESEARCH_AGENT_API_KEY": "optional-if-server-requires",
        "RESEARCH_AGENT_CLIENT_ID": "optional-if-server-requires-client-id"
      }
    }
  }
}
```

3. Claude Desktop を再起動する。

- **RESEARCH_AGENT_SERVER_URL**: 必須。research-agent サーバーの URL。
- **RESEARCH_AGENT_API_KEY**: サーバーが API キーを要求している場合のみ同じ値を設定。
- **RESEARCH_AGENT_CLIENT_ID**: サーバーが利用者識別を必須にしている場合（`RESEARCH_AGENT_REQUIRE_CLIENT_ID=true`）に、その利用者に割り当てた Client ID を設定。

## 使い方

- Claude に「製造業のDX事例を調査して」などと依頼 → 調査が開始される。
- 1〜2 分待ってから「結果を教えて」と依頼 → サマリーと CSV のダウンロード URL が返る。CSV は **ブラウザで URL を開くとダウンロード**されます。

## 制限

- このパッケージは **リモート専用** です。サーバー URL を指定してデプロイ済みサーバーに接続する前提です。
- ローカルでサーバーを立てずに開発・検証したい場合は、research-agent 本家リポジトリをクローンして `npm run mcp:dev` を使ってください。
