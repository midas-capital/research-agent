# サーバーデプロイ手順

サーバーに載せると、**他の人の Claude Desktop からもターミナルを起動せず**に事例調査が使えます。

---

## 全体像

1. **サーバー**に Express + Inngest をデプロイする（あなたが1台用意）
2. **Inngest Cloud** にアプリを登録し、ジョブをサーバーに送る
3. **使う人**は各自の Claude Desktop の MCP に「サーバー URL」と「Inngest のイベントキー」だけ設定する

---

## 1. Inngest Cloud の準備

1. [Inngest](https://www.inngest.com/) にサインアップ
2. **Create App** で新しいアプリを作成
3. **Event key** をコピー（MCP がイベントを送る時に使う）
4. **Signing key** をコピー（サーバーの環境変数 `INNGEST_SIGNING_KEY` に設定）
5. **Sync** または **App URL** に、あとでデプロイする URL を登録（例: `https://your-app.railway.app`）

---

## 2. サーバーをデプロイする

### 共通で必要な環境変数（サーバー側）

| 変数 | 必須 | 説明 |
|------|------|------|
| `ANTHROPIC_API_KEY` | ✅ | Anthropic API キー |
| `SERPAPI_API_KEY` | ✅ | SerpAPI キー |
| `INNGEST_SIGNING_KEY` | ✅ | Inngest の Signing key（Cloud で表示） |
| `APP_URL` | ✅ | デプロイ後の URL（例: `https://xxx.railway.app`） |
| `PORT` | - | 多くの PaaS が自動設定。未設定時は 3000 |
| `RESEARCH_AGENT_API_KEY` | - | 任意。設定すると `/api/runs/*` に API キー必須 |
| `DATA_DIR` / `OUTPUT_DIR` | - | 省略可。永続ボリュームのパスを指定する場合 |

**重要**: `data` と `output` は**永続化**が必要です。再デプロイや再起動で消えないように、各サービスの「ボリューム」や「永続ディスク」をマウントしてください。

---

### A. Railway でデプロイ

1. [Railway](https://railway.app/) で New Project → **Deploy from GitHub** でこのリポジトリを選択
2. **Variables** に上記の環境変数を設定
3. **Settings** → **Volumes** で `data` と `output` 用のボリュームを追加し、マウントパスを `/app/data` と `/app/output` に
4. ビルド方法: **Dockerfile** を検出してビルド、または **Nixpacks** の場合は `npm run build && node dist/server.js` に
5. デプロイ後、表示される URL を **APP_URL** と Inngest の App URL に設定

（Docker を使う場合）Root Directory を `.` にし、Dockerfile でビルド。

---

### B. Render でデプロイ

1. [Render](https://render.com/) で **New** → **Web Service**
2. リポジトリを接続
3. **Build Command**: `npm install && npm run build`
4. **Start Command**: `node dist/server.js`
5. **Environment** に上記の環境変数を設定
6. **Disk** で Persistent Disk を追加し、`/app/data` と `/app/output` にマウント（Render のディスクは1つなので、`/app/data` にマウントし、`DATA_DIR=/app/data`、`OUTPUT_DIR=/app/data/output` のようにサブディレクトリでも可）
7. 発行された URL を **APP_URL** と Inngest の App URL に設定

---

### C. Fly.io でデプロイ

1. [Fly.io](https://fly.io/) にログイン後、プロジェクトで `fly launch`
2. `fly secrets set ANTHROPIC_API_KEY=xxx SERPAPI_API_KEY=xxx INNGEST_SIGNING_KEY=xxx APP_URL=https://xxx.fly.dev`
3. 永続ボリューム: `fly volumes create data` と `fly volumes create output` で作成し、`fly.toml` でマウント
4. `fly deploy`
5. 発行された URL を **APP_URL** と Inngest の App URL に設定

---

### D. Docker で自前サーバーにデプロイ

```bash
# ビルド
docker build -t research-agent .

# 永続ボリューム付きで実行
docker run -d --name research-agent -p 3000:3000 \
  -e ANTHROPIC_API_KEY=xxx \
  -e SERPAPI_API_KEY=xxx \
  -e INNGEST_SIGNING_KEY=xxx \
  -e APP_URL=https://your-domain.com \
  -v research-agent-data:/app/data \
  -v research-agent-output:/app/output \
  research-agent
```

リバースプロキシ（nginx / Caddy）で HTTPS を終端し、**APP_URL** を `https://your-domain.com` に合わせる。

---

## 3. 使う人（他の人の PC）の設定

**ターミナルは起動しません。** 各自の Claude Desktop の MCP 設定だけ行います。

1. **Claude Desktop** → 設定 → Developer → **Edit config**
2. `claude_desktop_config.json` に以下を追加（`research-agent` のサーバー利用用）

```json
{
  "mcpServers": {
    "research-agent": {
      "command": "npx",
      "args": ["tsx", "/path/to/research-agent/src/mcp-server.ts"],
      "env": {
        "RESEARCH_AGENT_SERVER_URL": "https://your-app.railway.app",
        "INNGEST_EVENT_KEY": "your-inngest-event-key",
        "RESEARCH_AGENT_API_KEY": "optional-if-server-requires"
      }
    }
  }
}
```

- **RESEARCH_AGENT_SERVER_URL**: デプロイしたサーバーの URL（`https://...`）
- **INNGEST_EVENT_KEY**: Inngest の Event key（ジョブを送るために必要）
- **RESEARCH_AGENT_API_KEY**: サーバーで API キーを設定している場合のみ

**注意**: 各自の PC にこのリポジトリ（少なくとも `src/mcp-server.ts` と依存関係）が必要です。  
または、MCP サーバーだけを npm パッケージ化して `npx research-agent-mcp` のように配布する方法もあります。

3. Claude Desktop を**再起動**する。

---

## 4. 動作確認

1. 誰かの Claude Desktop で「製造業のDX事例を調査して」と入力
2. 「調査を開始しました」と返る
3. 1〜2分後に「結果を教えて」と入力
4. サマリーと Excel のダウンロード URL が返れば成功（Excel はブラウザで `RESEARCH_AGENT_SERVER_URL/api/runs/<runId>/excel` を開くとダウンロード）

---

## トラブルシューティング

- **結果が取れない**: サーバーの `DATA_DIR` / `OUTPUT_DIR` が永続化されているか確認。再起動で消えていると結果が 404 になる。
- **調査が始まらない**: 使う人の MCP に `INNGEST_EVENT_KEY` が正しく設定されているか、Inngest の App URL がサーバー URL と一致しているか確認。
- **401 Unauthorized**: サーバーで `RESEARCH_AGENT_API_KEY` を設定している場合、MCP の `RESEARCH_AGENT_API_KEY` を同じ値に設定する。
