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
| `OPENAI_API_KEY` | ✅ | OpenAI API キー（gpt-4o-mini 用） |
| `SERPER_API_KEY` | ✅ | Serper.dev の Web検索 API キー（なければ代わりに `SERPAPI_API_KEY` も参照） |
| `INNGEST_EVENT_KEY` | ✅ | Inngest Cloud の Event key（サーバーが `inngest.send()` する時に使用） |
| `INNGEST_SIGNING_KEY` | ✅ | Inngest Cloud の Signing key（Cloud が `/api/inngest` を呼ぶ時の検証用） |
| `APP_URL` | ✅ | デプロイ後の URL（例: `https://xxx.onrender.com`） |
| `PORT` | - | 多くの PaaS が自動設定。未設定時は 3000 |
| `DATA_DIR` | - | 省略可。例: `/app/data`（**DATABASE_URL 未設定時**の RunState 保存先） |
| `OUTPUT_DIR` | - | 省略可。例: `/app/output`（Excel を使う場合。現在は CSV のみなら未使用でも可） |
| `DATABASE_URL` | - | **推奨（本番）**。Postgres の接続文字列。設定すると RunState を DB に保存し、複数インスタンス・再起動後も結果が残る（「Inngest 上ではあるのに結果が見つからない」を解消）。例: `postgresql://user:pass@host:5432/dbname` |
| `RESEARCH_AGENT_API_KEY` | - | 任意。設定すると `/api/runs/*` に API キー必須 |

**RunState の永続化**: `DATABASE_URL` を設定すると RunState は Postgres に保存され、永続ディスクは不要。未設定の場合は `DATA_DIR` のファイルに保存するため、Render では Persistent Disk のマウントまたは有料プランでの永続化を推奨する。

#### RunState を DB に保存する場合（推奨）

1. Postgres を用意する（下記 **Render Postgres** や [Neon](https://neon.tech/)、[Supabase](https://supabase.com/) など）。
2. 接続文字列をコピーし、サーバーの環境変数 **`DATABASE_URL`** に設定する（例: `postgresql://user:pass@host:5432/dbname`）。
3. 起動時に `run_states` テーブルが自動作成される。Persistent Disk は RunState 用には不要。

**Render Postgres を使う場合**

1. [Render ダッシュボード](https://dashboard.render.com/)で **New** → **PostgreSQL**
2. 名前・リージョン（Web サービスと同じにするとレイテンシが良い）を選び **Create Database**
3. 作成後、**Connections** の **Internal Database URL** をコピー（同じ Render アカウント内の Web サービスからはこちらを使う）
4. research-agent の **Web Service** を開き **Environment** → **Add Environment Variable**
   - Key: `DATABASE_URL`
   - Value: コピーした **Internal Database URL** をそのまま貼る
5. **Save Changes** で再デプロイ。起動時に `run_states` が自動作成され、以降の調査結果は DB に保存される

（外部から接続する場合は **External Database URL** を使う。同一アカウント内なら Internal で十分。）

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
5. **Environment** に上記の環境変数を設定。**`DATABASE_URL`** は「RunState を DB に保存する場合」の **Render Postgres を使う場合** の手順で設定すると、RunState が Postgres に保存され、次項の Disk は RunState 用には不要。
6. **Disk**（`DATABASE_URL` 未設定時）: Persistent Disk を追加し、`/app/data` にマウント（`DATA_DIR=/app/data`、`OUTPUT_DIR=/app/data/output` など）。
7. 発行された URL を **APP_URL** と Inngest の App URL に設定

**GitHub の push で Render を自動デプロイする（Auto-Deploy）**
- Web Service → **Settings** → **Build & Deploy**
- **Branch**: `main`
- **Auto-Deploy**: `Yes`（On commit / Automatic と表示される場合あり）
- 動作確認: `Events / Logs` に新しい **Deploy** が出るか確認（出ない場合は Manual Deploy で latest が反映されるか確認）

※ `render.yaml` は Blueprint 作成時の例です（既存サービスの Auto-Deploy 設定はダッシュボード側です）。

---

### C. Fly.io でデプロイ

1. [Fly.io](https://fly.io/) にログイン後、プロジェクトで `fly launch`
2. `fly secrets set OPENAI_API_KEY=xxx SERPAPI_API_KEY=xxx INNGEST_SIGNING_KEY=xxx APP_URL=https://xxx.fly.dev`
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
  -e OPENAI_API_KEY=xxx \
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

### 簡単セットアップ（推奨）

1. ターミナルで実行（バージョンは [packages/mcp/package.json](../packages/mcp/package.json) の `version` と一致させる。現行 **1.0.7**）:
   ```bash
   npx -y research-agent-mcp@1.0.7 research-agent-mcp-setup
   ```
2. 表示に従って **サーバー URL**（例: `https://your-app.onrender.com`）を入力。続けて **API キー**・**Client ID** が必要なら順に入力（サーバー要件は `GET /health` で判定）。
3. **Claude Desktop を再起動**する。

リポジトリのクローンやパスの指定は不要です。

### 手動で設定する場合

1. **Claude Desktop** → 設定 → Developer → **Edit config**
2. `claude_desktop_config.json` の `mcpServers` に以下を追加:

```json
{
  "mcpServers": {
    "research-agent": {
      "command": "npx",
      "args": ["-y", "research-agent-mcp@1.0.7"],
      "env": {
        "RESEARCH_AGENT_SERVER_URL": "https://your-app.onrender.com",
        "RESEARCH_AGENT_API_KEY": "optional-if-server-requires",
        "RESEARCH_AGENT_CLIENT_ID": "optional-if-server-requires-client-id"
      }
    }
  }
}
```

- **RESEARCH_AGENT_SERVER_URL**: デプロイしたサーバーの URL（`https://...`）のみ必須。  
  **INNGEST_EVENT_KEY は入れない**（イベント送信はサーバー側のみ）。
- **RESEARCH_AGENT_API_KEY**: サーバーで API キーを要求している場合のみ同じ値を設定。
- **RESEARCH_AGENT_CLIENT_ID**: サーバーで `RESEARCH_AGENT_REQUIRE_CLIENT_ID=true` のとき、割り当てた Client ID を設定。

**注意**: `npx research-agent-mcp` を使う場合は Node.js が入っていればよく、リポジトリのクローンは不要です。開発用にリポジトリから直接動かす場合は `args`: `["tsx", "/path/to/research-agent/src/mcp-server.ts"]` と `RESEARCH_AGENT_SERVER_URL` を設定してください。

3. Claude Desktop を**再起動**する。

---

## 4. 動作確認

1. 誰かの Claude Desktop で「製造業のDX事例を調査して」と入力
2. 「調査を開始しました」と返る
3. 1〜2分後に「結果を教えて」と入力
4. サマリーと CSV のダウンロード URL が返れば成功（**CSV はブラウザで URL を開くとダウンロード**される）

調査の進捗は、`GET /api/runs/:runId` の `status`（pending / running / completed / failed）または **Inngest Cloud のダッシュボード**（Functions → Run のタイムライン）で確認できる。

---

## 5. コード変更後の再デプロイ

- 変更を GitHub に push すると、Render が自動でビルド・デプロイする。
- すぐ反映したいときは、Render のサービス画面で **Manual Deploy** → **Clear build cache & deploy** を実行する。

---

## トラブルシューティング

- **結果が取れない / 以前の runId で CSV が見つからない**: research-agent に「一定時間後に結果を削除する」仕様はない。結果は `DATA_DIR` のファイルに保存されるが、**Render Free ではディスクが永続化されない**ため、インスタンスのスリープ復帰・再起動・再デプロイでファイルが消える。そのため、完了直後は取れても、しばらく経ってから同じ runId の CSV URL を開くと「Run not found」になる。対処: **Persistent Disk** を `DATA_DIR` にマウントする（Render の Disks で追加）。または将来的に DB に保存する実装にすると結果が残る。
- **調査が始まらない / Inngest に Run が出ない**:  
  - **Render** に `INNGEST_EVENT_KEY` と `INNGEST_SIGNING_KEY` が設定されているか確認。  
  - Inngest のアプリで **Serve URL** が `https://あなたのRenderドメイン/api/inngest` になっているか確認。  
  - MCP には **INNGEST_EVENT_KEY を入れない**（サーバーだけが送る）。
- **401 Unauthorized**: サーバーで `RESEARCH_AGENT_API_KEY` を設定している場合、MCP の `RESEARCH_AGENT_API_KEY` を同じ値に設定する。
- **Claude が「CSV 取得に失敗しました」と言う**: CSV の URL は**ブラウザで開くとダウンロード**される。Claude が URL をプログラムで取得しようとすると失敗することがある。MCP の案内文で「ブラウザで開いてください」「URL の取得は行わないでください」と返すようにしているので、その案内に従いユーザーがブラウザで URL を開けばよい。サーバー側の CSV エンドポイントは正常に動作している。
