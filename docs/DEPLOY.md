# サーバーデプロイ手順

サーバーに載せると、**他の人の Claude Desktop からもターミナルを起動せず**に事例調査が使えます。

---

## 完全クラウド移行（ローカル不要）

**ローカルで `npm run dev` / `npm run inngest:dev` を一切動かさず、すべて Render + Inngest Cloud で完結させる**手順です。

### 役割の整理

| 役割 | どこで動く | 必要なもの |
|------|------------|------------|
| イベント送信 | **Render 上のサーバー**（`POST /api/cases/search` が `inngest.send()` する） | Render に `INNGEST_EVENT_KEY` |
| ジョブ実行 | **Inngest Cloud** が Render の `/api/inngest` を呼ぶ | Render に `INNGEST_SIGNING_KEY`、Inngest に Serve URL 登録 |
| 結果取得 | Claude → MCP → **Render の `/api/runs/*`** | MCP には **サーバー URL だけ**（`INNGEST_EVENT_KEY` は不要） |

**重要**: Claude / MCP の環境変数に `INNGEST_EVENT_KEY` を**入れない**でください。イベントはサーバー（Render）だけが送ります。

### 完全クラウド移行チェックリスト

- [ ] **Render** の環境変数に `INNGEST_EVENT_KEY` と `INNGEST_SIGNING_KEY` を設定（Inngest の App → Settings → Event Keys / Signing Key）
- [ ] **Inngest** のアプリで Serve URL を `https://<Renderのドメイン>/api/inngest` に設定
- [ ] **Claude** の MCP の `env` には `RESEARCH_AGENT_SERVER_URL` のみ（`INNGEST_EVENT_KEY` は入れない）
- [ ] ローカルでは `npm run dev` / `npm run inngest:dev` を**起動しない**

### バックグラウンドの動き

「バックグラウンド」で動くのは**別プロセスではなく、Inngest Cloud があなたのサーバーを呼び出す仕組み**です。

1. **きっかけ**  
   Claude が「事例調査して」→ MCP が `POST /api/cases/search` を Render に送る。

2. **即レス**  
   Render のサーバーは `runId` を生成し、`inngest.send("cases/search", { runId, query })` で Inngest Cloud にイベントを送ってから、すぐに `202 { runId }` を返す。この時点では**重い処理はまだ実行していない**。

3. **ジョブの実行（＝ここがバックグラウンド）**  
   Inngest Cloud がイベントを受け取ると、**後から**あなたのサーバーに  
   `POST https://<Renderのドメイン>/api/inngest`  
   を送る。Render 上の**同じ Web サービス（同じ Node プロセス）**がこのリクエストを受け、Inngest の関数（軸生成・検索・選別・構造化・補足検索など）を**そのリクエスト処理のなかで**実行する。

4. **結果**  
   実行中に RunState が `DATA_DIR` に保存され、完了後は `GET /api/runs/:runId/csv` で CSV を取得できる。

**まとめ**:  
- **別の「バックグラウンド用サーバー」は立てていない**。  
- バックグラウンド＝「ユーザーリクエストとは別のタイミングで、Inngest Cloud が Render の `/api/inngest` を呼び、同じアプリが重い処理を実行する」動き。  
- Render の Free プランではアイドル時にスリープするため、Inngest が呼んだタイミングで**コールドスタート**が入ることがある。

---

## 全体像

1. **サーバー**に Express + Inngest をデプロイする（Render など）
2. **Inngest Cloud** にアプリを登録し、Serve URL をサーバーの `/api/inngest` に設定
3. **使う人**は Claude Desktop の MCP に「サーバー URL」だけ設定（Event Key はサーバー側のみ）

---

## 1. Inngest Cloud の準備

1. [Inngest](https://www.inngest.com/) にサインアップ
2. **Create App** で新しいアプリを作成（または既存の `research-agent`）
3. **Event key** をコピー → **Render の環境変数 `INNGEST_EVENT_KEY` にだけ**入れる（MCP には入れない）
4. **Signing key** をコピー → Render の環境変数 `INNGEST_SIGNING_KEY` に設定
5. アプリの **Serve URL** を `https://あなたのRenderドメイン/api/inngest` に設定（例: `https://research-agent-xxx.onrender.com/api/inngest`）

---

## 2. サーバーをデプロイする

### 共通で必要な環境変数（サーバー側）

| 変数 | 必須 | 説明 |
|------|------|------|
| `ANTHROPIC_API_KEY` | ✅ | Anthropic API キー |
| `SERPAPI_API_KEY` | ✅ | SerpAPI キー |
| `INNGEST_EVENT_KEY` | ✅ | Inngest Cloud の Event key（サーバーが `inngest.send()` する時に使用） |
| `INNGEST_SIGNING_KEY` | ✅ | Inngest Cloud の Signing key（Cloud が `/api/inngest` を呼ぶ時の検証用） |
| `APP_URL` | ✅ | デプロイ後の URL（例: `https://xxx.onrender.com`） |
| `PORT` | - | 多くの PaaS が自動設定。未設定時は 3000 |
| `DATA_DIR` | - | 省略可。例: `/app/data`（RunState の保存先） |
| `OUTPUT_DIR` | - | 省略可。例: `/app/output`（Excel を使う場合。現在は CSV のみなら未使用でも可） |
| `RESEARCH_AGENT_API_KEY` | - | 任意。設定すると `/api/runs/*` に API キー必須 |

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
2. `claude_desktop_config.json` に以下を追加（**完全クラウド運用**用）

```json
{
  "mcpServers": {
    "research-agent": {
      "command": "npx",
      "args": ["tsx", "/path/to/research-agent/src/mcp-server.ts"],
      "env": {
        "RESEARCH_AGENT_SERVER_URL": "https://your-app.onrender.com",
        "RESEARCH_AGENT_API_KEY": "optional-if-server-requires"
      }
    }
  }
}
```

- **RESEARCH_AGENT_SERVER_URL**: デプロイしたサーバーの URL（`https://...`）のみ必須。  
  **INNGEST_EVENT_KEY は入れない**（イベント送信はサーバー側のみ）。
- **RESEARCH_AGENT_API_KEY**: サーバーで API キーを要求している場合のみ同じ値を設定。

**注意**: 各自の PC にこのリポジトリ（少なくとも `src/mcp-server.ts` と依存関係）が必要です。  
または、MCP サーバーだけを npm パッケージ化して `npx research-agent-mcp` のように配布する方法もあります。

3. Claude Desktop を**再起動**する。

---

## 4. 動作確認

1. 誰かの Claude Desktop で「製造業のDX事例を調査して」と入力
2. 「調査を開始しました」と返る
3. 1〜2分後に「結果を教えて」と入力
4. サマリーと CSV のダウンロード URL が返れば成功（ブラウザで `https://あなたのRenderドメイン/api/runs/<runId>/csv` を開くとダウンロード）

---

## トラブルシューティング

- **結果が取れない**: サーバーの `DATA_DIR` が永続化されているか確認。Render の Free プランでは再デプロイで消えるため、Persistent Disk をマウントするか有料プランで永続化する。
- **調査が始まらない / Inngest に Run が出ない**:  
  - **Render** に `INNGEST_EVENT_KEY` と `INNGEST_SIGNING_KEY` が設定されているか確認。  
  - Inngest のアプリで **Serve URL** が `https://あなたのRenderドメイン/api/inngest` になっているか確認。  
  - MCP には **INNGEST_EVENT_KEY を入れない**（サーバーだけが送る）。
- **401 Unauthorized**: サーバーで `RESEARCH_AGENT_API_KEY` を設定している場合、MCP の `RESEARCH_AGENT_API_KEY` を同じ値に設定する。
