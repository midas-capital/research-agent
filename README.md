# 事例調査エージェント (Research Agent)

Claude Desktop から「事例調査をして」「〇〇の事例を調べて」と依頼すると、バックグラウンドで Web 検索・選別・構造化を行い、**サマリーと CSV ダウンロード URL** で結果を返すエージェントです。

---

## 目次

- [できること](#できること)
- [使用の流れ](#使用の流れ)
- [アーキテクチャ](#アーキテクチャ)
- [技術スタック](#技術スタック)
- [必要なもの](#必要なもの)
- [クイックスタート](#クイックスタート)
- [設定](#設定)
- [課金について](#課金について)
- [デプロイ・他端末での利用](#デプロイ他端末での利用)
- [プロジェクト構成](#プロジェクト構成)
- [ライセンス](#ライセンス)

---

## できること

- **自然言語で事例調査を開始**: 「製造業のDX導入事例を調べて」「アパレルのコスト削減事例」など、テーマを伝えるだけで調査ジョブを開始
- **自動で軸・カテゴリ設計**: テーマに合わせて LLM が分類軸とカテゴリを生成
- **Web 検索〜構造化まで一括実行**: 検索クエリ生成 → 検索 API で URL 取得 → HTML 取得 → 事例かどうか選別・企業名・課題・解決策・効果を構造化（すべてバックグラウンド）
- **結果の取得**: 完了後、Claude に「結果を教えて」と依頼すると、軸別件数・サマリーと **CSV ダウンロード用 URL** を表示。CSV はブラウザで URL を開くとダウンロード可能
- **ローカル / クラウド両対応**: 自分の PC だけで動かすことも、Render などにデプロイして他端末の Claude から使うことも可能

---

## 使用の流れ

```
[ユーザー]  「製造業のDX事例を調査して」
      ↓
[Claude]    MCP ツール search_cases を呼ぶ
      ↓
[MCP]       サーバーへ POST /api/cases/search（クラウド） or ローカルで Inngest にイベント送信
      ↓
[サーバー]  runId を返す（202）。バックグラウンドで Inngest がジョブを実行開始
      ↓
[ユーザー]  1〜2 分待って「結果を教えて」
      ↓
[Claude]    MCP ツール get_case_study_result を呼ぶ
      ↓
[MCP]       GET /api/runs/:runId で状態取得。完了していればサマリー＋CSV URL を返す
      ↓
[ユーザー]  サマリーを確認し、CSV の URL をブラウザで開いてダウンロード
```

**バックグラウンドで行われる処理（Inngest 関数内）**:

1. **軸・カテゴリ生成** — テーマから分類軸とカテゴリを LLM で生成  
2. **検索クエリ生成** — 各軸・カテゴリごとに日本語・英語の検索クエリを LLM で生成  
3. **Web 検索** — 検索 API（Serper.dev / SerpAPI）で URL とスニペットを取得  
4. **HTML 取得** — 各 URL に HTTP でアクセスして HTML を取得  
5. **HTML→構造化** — cheerio でタイトル・見出し・本文を抽出（文字数制限あり）  
6. **選別・構造化** — LLM で「事例かどうか」を判定し、企業名・課題・解決策・効果を JSON で抽出（Zod で検証）  
7. **初回保存** — ここまでの結果を RunState として保存  
8. **件数補充**（オプション）— 不足している軸・カテゴリを検索・選別してマージ（LIGHT_MODE 時は 0 回）  
9. **重複フラグ・完了** — 重複をマークし、RunState を completed で保存  

結果は **Postgres（`DATABASE_URL` 設定時）** または **`DATA_DIR` の JSON ファイル** に保存され、CSV は API がその場で生成して返します。

---

## アーキテクチャ

### 全体図

```
                    ┌─────────────────┐
                    │  Claude Desktop  │
                    │  (ユーザー入力・  │
                    │   結果表示)       │
                    └────────┬────────┘
                             │ stdio (MCP)
                             ▼
                    ┌─────────────────┐
                    │  MCP Server     │
                    │  search_cases   │
                    │  get_case_      │
                    │  study_result   │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │ ローカル            │                    │ クラウド
         │ RESEARCH_AGENT_    │                    │ RESEARCH_AGENT_
         │ SERVER_URL 未設定   │                    │ SERVER_URL 設定
         ▼                    │                    ▼
  ┌──────────────┐            │             ┌──────────────┐
  │ Inngest Dev  │            │             │  Render 等   │
  │ (localhost   │            │             │  Express     │
  │  8288)       │            │             │  POST /api/  │
  └──────┬───────┘            │             │  cases/search│
         │                    │             │  GET /api/   │
         │ イベント送信         │             │  runs/*      │
         ▼                    │             └──────┬───────┘
  ┌──────────────┐            │                    │
  │ Express      │◄───────────┘                    │ inngest.send
  │ (localhost   │   /api/inngest を叩く            ▼
  │  3000)       │                          ┌──────────────┐
  └──────┬───────┘                          │ Inngest Cloud│
         │                                  │ ジョブ実行   │
         │                                  └──────┬───────┘
         ▼                                         │
  ┌──────────────┐                                 │ POST /api/inngest
  │ RunState     │                                 ▼
  │ DATA_DIR または│                          ┌──────────────┐
  │ DATABASE_URL │                          │ 同上 Express │
  │ (Postgres)   │                          │ 関数実行     │
  └──────────────┘                          └──────────────┘
```

### コンポーネント

| コンポーネント | 役割 |
|----------------|------|
| **Claude Desktop** | ユーザーが「事例調査して」「結果を教えて」と入力し、MCP のツール呼び出しと返却テキストを表示 |
| **MCP Server** | stdio で Claude と通信。`search_cases` で調査開始、`get_case_study_result` で状態・サマリー・CSV URL を返す。ローカル時は RunState を直接読む／クラウド時はサーバー API を呼ぶ |
| **Express** | `POST /api/cases/search`（runId 発行・Inngest 送信）、`GET /api/inngest`（Inngest の実行エンドポイント）、`GET /api/runs/*`（RunState・CSV 配布）、`GET /health` |
| **Inngest** | バックグラウンドジョブのスケジューリング・ステップ実行・リトライ。開発時は Inngest Dev Server がローカルの Express を叩く。本番は Inngest Cloud がデプロイ先の `/api/inngest` を叩く |
| **RunState 保存** | `DATABASE_URL` あり → Postgres の `run_states` テーブル。なし → `DATA_DIR/runs/<runId>.json`。CSV はファイルではなく API が RunState からその場で生成 |

---

## 技術スタック

| 分類 | 技術 |
|------|------|
| **ランタイム・言語** | Node.js 18+ / TypeScript (ESM) |
| **クライアント UI** | Claude Desktop（MCP 対応） |
| **プロトコル** | MCP (Model Context Protocol), stdio トランスポート |
| **サーバー** | Express 4.x |
| **ジョブキュー・バックグラウンド** | Inngest（開発: Inngest Dev Server / 本番: Inngest Cloud） |
| **LLM** | OpenAI API（**gpt-4o-mini**）。軸・カテゴリ生成、検索クエリ生成、選別・構造化のいずれも同一モデル。出力は `response_format: { type: "json_object" }` と Zod で検証 |
| **Web 検索** | Serper.dev（推奨）または SerpAPI。1 クエリあたりの件数は `searchPerCategory` で制御 |
| **HTML 取得** | axios（タイムアウト・リダイレクト・User-Agent 設定あり） |
| **HTML パース** | cheerio。script/style/nav 等を除去し、タイトル・meta・見出し・本文を抽出。本文は `contentMaxChars`（デフォルト 3000）で打ち切り |
| **永続化** | 未設定時: ファイル（`DATA_DIR/runs/<runId>.json`）。`DATABASE_URL` 設定時: PostgreSQL（`pg`）。テーブル `run_states`（run_id, payload JSONB） |
| **CSV 出力** | サーバーが RunState からその場で CSV を組み立てて `Content-Disposition: attachment` で返却。Excel はローカル運用時のみ MCP が ExcelJS で生成可能 |
| **検証・型** | Zod（LLM 出力の JSON スキーマ検証） |

---

## 必要なもの

- **Node.js** 18 以上
- **Claude Desktop**（MCP 対応版）
- **API キー**:  
  - **OpenAI**（`OPENAI_API_KEY`）— gpt-4o-mini 用  
  - **Serper.dev** または **SerpAPI**（`SERPER_API_KEY` / `SERPAPI_API_KEY`）— Web 検索用  
- クラウドで使う場合: デプロイ先（例: Render）、Inngest Cloud のアカウント、必要に応じて Postgres（Render Postgres 等）

---

## クイックスタート

### クラウドサーバーをそのまま使う場合（リポジトリ不要）

デプロイ済みの research-agent サーバー URL が共有されている場合:

```bash
npx -y -p research-agent-mcp research-agent-mcp-setup --url=https://your-app.onrender.com
```

表示に従って URL（と必要なら API キー）を入力し、Claude Desktop を再起動すれば利用開始です。詳細は [packages/mcp/README.md](packages/mcp/README.md) を参照してください。

### ローカルでサーバーから動かす場合

1. **リポジトリのクローンと依存関係**

   ```bash
   git clone https://github.com/<your-org>/research-agent.git
   cd research-agent
   npm install
   ```

2. **環境変数**

   ```bash
   cp .env.example .env
   ```

   `.env` に最低限を設定:

   - `OPENAI_API_KEY` — OpenAI の API キー  
   - `SERPER_API_KEY` または `SERPAPI_API_KEY` — Web 検索用  

3. **2 ターミナルで起動**

   **ターミナル 1（Express）**

   ```bash
   npm run dev
   ```

   **ターミナル 2（Inngest Dev Server）**

   ```bash
   npm run inngest:dev
   ```

4. **Claude Desktop の MCP 設定**

   - 設定 → Developer → Edit config で `claude_desktop_config.json` を開く  
   - `mcpServers` に `research-agent` を追加（ローカル用）:

   ```json
   {
     "mcpServers": {
       "research-agent": {
         "command": "npx",
         "args": ["tsx", "/absolute/path/to/research-agent/src/mcp-server.ts"],
         "env": {
           "DATA_DIR": "/absolute/path/to/research-agent/data",
           "OUTPUT_DIR": "/absolute/path/to/research-agent/output"
         }
       }
     }
   }
   ```

   パスは環境に合わせて書き換えてください。Claude Desktop を再起動します。

5. **利用**

   Claude で「〇〇の事例を調査して」と入力 → 1〜2 分待って「結果を教えて」→ サマリーと CSV の URL が返ります。CSV はその URL をブラウザで開いてダウンロードします。

より細かい手順は [docs/QUICKSTART.md](docs/QUICKSTART.md) を参照してください。

---

## 設定

### 環境変数（主要なもの）

| 変数 | 必須 | 説明 |
|------|------|------|
| `OPENAI_API_KEY` | ✅ | OpenAI API キー（gpt-4o-mini 用） |
| `SERPER_API_KEY` / `SERPAPI_API_KEY` | ✅ | Web 検索 API キー（Serper 推奨） |
| `DATA_DIR` | — | RunState のファイル保存先（未設定時: `./data`）。`DATABASE_URL` 設定時は RunState は DB に保存 |
| `OUTPUT_DIR` | — | Excel 出力先（ローカルで Excel を使う場合）。未設定時: `./output` |
| `APP_URL` | ✅ 本番 | アプリの URL（Inngest 用）。開発: `http://localhost:3000` |
| `DATABASE_URL` | — | Postgres の接続文字列。設定すると RunState を DB に保存（本番推奨） |
| `RESEARCH_AGENT_API_KEY` | — | 設定すると `/api/cases/search` と `/api/runs/*` に API キー必須。MCP の env にも同じ値を設定 |
| `LIGHT_MODE` | — | `true`（デフォルト）で件数少なめ、`false` で本番向けのデフォルト値 |

### 料金・トークンを抑える設定（LIGHT_MODE）

デフォルトは `LIGHT_MODE=true` で、次のような「少なめ」のデフォルトになります。

| 項目 | LIGHT_MODE=true | LIGHT_MODE=false |
|------|-----------------|------------------|
| 目標事例数 | 10 件 | 100 件 |
| 軸の数 | 2 | 5 |
| 軸あたりカテゴリ | 2 | 5 |
| カテゴリあたり検索件数 | 2〜3 件 | 5〜7 件 |
| 件数補充 | 0 回 | 最大 3 回 |

個別に上書きする場合は、環境変数で `MAX_AXES` / `MAX_CATEGORIES_PER_AXIS` / `MAX_CASES_TARGET` / `SEARCH_PER_CATEGORY_MIN` / `SEARCH_PER_CATEGORY_MAX` / `MAX_SUPPLEMENT_ROUNDS` を設定します。**環境変数で指定した値が優先**され、LIGHT_MODE は「未指定時のデフォルト」だけに効きます。一覧は `.env.example` を参照してください。

---

## 課金について

**有料になるのは次の 2 つです。**

| 項目 | 用途 | 備考 |
|------|------|------|
| **OPENAI_API_KEY** | 軸・カテゴリ、検索クエリ、選別・構造化（gpt-4o-mini） | 従量課金 |
| **SERPER_API_KEY** / **SERPAPI_API_KEY** | Web 検索（Serper.dev / SerpAPI） | 従量課金 |

Inngest は無料枠あり。RunState を Postgres に保存する場合は、Render Postgres 等の DB 利用料が別途かかります。

---

## デプロイ・他端末での利用

- **サーバーをデプロイして他端末の Claude から使う**: [docs/DEPLOY.md](docs/DEPLOY.md) に、Render・Inngest Cloud・環境変数・他端末の MCP 設定を記載しています。
- **使う人側**: デプロイ済みサーバー URL があれば、上記の `npx ... research-agent-mcp-setup` で MCP を追加するだけで利用できます（リポジトリのクローン不要）。

---

## プロジェクト構成

```
research-agent/
├── src/
│   ├── server.ts           # Express: /api/cases/search, /api/inngest, /api/runs/*
│   ├── mcp-server.ts       # MCP サーバー（ローカル＋リモート両対応）
│   ├── config.ts           # 環境変数と定数
│   ├── inngest/
│   │   ├── client.ts       # Inngest クライアント
│   │   └── functions/
│   │       └── case-study.ts  # caseStudySearch / caseStudySupplement
│   └── lib/
│       ├── axes.ts         # 軸・カテゴリ生成（LLM）
│       ├── queries.ts      # 検索クエリ生成（LLM）
│       ├── search.ts       # Web 検索（Serper/SerpAPI）
│       ├── fetch-html.ts   # HTML 取得
│       ├── html-to-json.ts # HTML → タイトル・見出し・本文
│       ├── screen-structure.ts  # 選別・構造化（LLM + Zod）
│       ├── run-store.ts    # RunState の読み書き（DB or ファイル）
│       ├── db.ts           # Postgres 接続・run_states 操作
│       └── ...
├── packages/mcp/           # npm パッケージ（リモート専用 MCP クライアント）
├── docs/                   # QUICKSTART, DEPLOY, STATUS 等
├── .env.example
└── README.md
```

---

## ライセンス

MIT
