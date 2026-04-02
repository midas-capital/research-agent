# 事例調査エージェント (Research Agent)

Claude Desktop から「事例調査をして」「〇〇の事例を調べて」と依頼すると、バックグラウンドで Web 検索・選別・構造化を行い、**サマリーと CSV ダウンロード URL** で結果を返すエージェントです。

---

## 目次

- [できること](#できること)
- [使用の流れ](#使用の流れ)
- [クイックスタート](#クイックスタート)
- [アーキテクチャ](#アーキテクチャ)
- [技術スタック](#技術スタック)
- [必要なもの（利用者）](#必要なもの利用者)
- [使い方（本番環境）](#使い方本番環境)
- [設定](#設定)
- [運用台帳（最小）](#運用台帳最小)
- [課金について](#課金について)
- [デプロイ・他端末での利用](#デプロイ他端末での利用)
- [プロジェクト構成](#プロジェクト構成)
- [ライセンス](#ライセンス)

---

## できること

- **自然言語で事例調査を開始**: 「製造業のDX導入事例を調べて」「アパレルのコスト削減事例」など、テーマを伝えるだけで調査ジョブを開始
- **自動で軸・カテゴリ設計**: テーマに合わせて LLM が分類軸とカテゴリを生成
- **Web 検索〜構造化まで一括実行**: 検索クエリ生成 → 検索 API で URL 取得 → HTML 取得 → 事例かどうか選別・企業名・課題・解決策・効果を構造化（すべてバックグラウンド）
- **結果の取得**: 完了後、Claude に「結果を教えて」と依頼すると、軸別件数・サマリーと **CSV ダウンロード用 URL** を表示。CSV はブラウザで URL を開くとダウンロード可能（認証が有効な場合は約 10 分の短命トークン付き）

---

## 使用の流れ

```
[ユーザー]  「製造業のDX事例を調査して」
      ↓
[Claude]    MCP ツール search_cases を呼ぶ
      ↓
[MCP]       サーバーへ POST /api/cases/search を送信
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

---
## クイックスタート

### 使う手順（最短）
1. Claude Desktop に MCP を追加（他端末 / 初回のみ）
   ```bash
   npx -y --package=research-agent-mcp@latest -- research-agent-mcp-setup --url=https://research-agent-wpx8.onrender.com
   ```
2. Claude に依頼する
   - 例: 「製造業のDX導入事例を調査して」
3. 1〜2分後に「結果を教えて」
4. 表示された **CSV ダウンロード URL** をブラウザで開く

注意:
- API キーが有効な場合、CSV は短命トークン付き URL で配布されます（有効期限は約 10分）。
- Claude が URL をプログラムで取得しようとすると失敗することがあるため、必ずブラウザで開いてください。

### 関わるツール（誰が何をするか）
- **Claude Desktop**: ユーザーの入力と、MCP ツール呼び出し / 返却を表示
- **MCP Server（`research-agent-mcp`）**: Claude とサーバーをつなぐ“薄いクライアント”。`cases/search` を開始し、`runs/:runId` の状態と CSV ダウンロード URL を返します
- **Render 上の Express サーバー**: ジョブ開始（`POST /api/cases/search`）、結果取得（`GET /api/runs/:runId`）、CSV配布（`GET /api/runs/:runId/csv`）を担当
- **Inngest Cloud**: バックグラウンドで段階実行するオーケストレータ（軸生成→検索→HTML→選別→補充→完了）
- **OpenAI API**: 軸・カテゴリ、検索クエリ生成、事例の選別と構造化（Zod で検証）
- **Serper.dev**: 検索結果（URL とスニペット）の取得
- **Postgres（`DATABASE_URL` 設定時のみ）**: RunState（実行結果）の永続化


**バックグラウンドで行われる処理（Inngest 関数内）**:

1. **軸・カテゴリ生成** — テーマから分類軸とカテゴリを LLM で生成  
2. **検索クエリ生成** — 各軸・カテゴリごとに日本語・英語の検索クエリを LLM で生成  
3. **Web 検索** — 検索 API（Serper.dev）で URL とスニペットを取得  
4. **HTML 取得** — 各 URL に HTTP でアクセスして HTML を取得  
5. **HTML→構造化** — cheerio でタイトル・見出し・本文を抽出（文字数制限あり）  
6. **選別・構造化** — LLM で「事例かどうか」を判定し、企業名・課題・解決策・効果を JSON で抽出（Zod で検証）  
7. **初回保存** — ここまでの結果を RunState として保存  
8. **件数補充**（オプション）— 不足している軸・カテゴリを検索・選別してマージ（LIGHT_MODE 時は 0 回）  
9. **重複除去・完了** — `dedupCases` で重複事例を除き、RunState を completed で保存  

結果は **Postgres（`DATABASE_URL` 設定時）** または **ローカルファイル（`./data/runs/*.json`）** に保存され、CSV は API がその場で生成して返します。

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
| **Express** | `POST /api/cases/search`（runId 発行・Inngest 送信）、`GET /api/inngest`（Inngest の実行エンドポイント）、`GET /api/runs/*`（RunState・CSV 配布）、`GET /api/verify`（認証確認）、`GET /health`（生存確認・要件ヒント） |
| **Inngest** | バックグラウンドジョブのスケジューリング・ステップ実行・リトライ。開発時は Inngest Dev Server がローカルの Express を叩く。本番は Inngest Cloud がデプロイ先の `/api/inngest` を叩く |
| **RunState 保存** | `DATABASE_URL` あり → Postgres の `run_states` テーブル。なし → `./data/runs/<runId>.json`。CSV はファイルではなく API が RunState からその場で生成 |

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
| **Web 検索** | Serper.dev。1 クエリあたりの件数は `searchPerCategory` で制御 |
| **HTML 取得** | axios（タイムアウト・リダイレクト・User-Agent 設定あり） |
| **HTML パース** | cheerio。script/style/nav 等を除去し、タイトル・meta・見出し・本文を抽出。本文は `contentMaxChars`（デフォルト 3000）で打ち切り |
| **永続化** | 未設定時: ファイル（`./data/runs/<runId>.json`）。`DATABASE_URL` 設定時: PostgreSQL（`pg`）。テーブル `run_states`（run_id, payload JSONB） |
| **CSV 出力** | サーバーが RunState からその場で CSV を組み立てて `Content-Disposition: attachment` で返却。Excel はローカル運用時のみ MCP が ExcelJS で生成可能 |
| **検証・型** | Zod（LLM 出力の JSON スキーマ検証） |

---

## 必要なもの（利用者）

- **Claude Desktop**（MCP 対応版）
- **デプロイ済み research-agent サーバーの URL**（管理者から共有されるか、自分でデプロイしたサーバー）
- サーバーが API キーを要求している場合のみ、その **API キー**

---

## 使い方（本番環境）

1. **MCP のセットアップ（初回のみ）**

   ターミナルで次を実行し、表示に従ってサーバー URL（と必要なら API キー・Client ID）を入力します。**`@latest` を使って常に最新の `research-agent-mcp` を実行**します。

   ```bash
   npx -y --package=research-agent-mcp@latest -- research-agent-mcp-setup --url=https://research-agent-wpx8.onrender.com
   ```

   URL を変更する場合は `--url=...` の部分だけ差し替えてください。

   完了したら **Claude Desktop を再起動**します。詳細は [packages/mcp/README.md](packages/mcp/README.md) を参照してください。

2. **事例調査を開始する**

   Claude で「〇〇の事例を調査して」「製造業のDX導入事例を調べて」などと入力します。Claude が MCP 経由でサーバーに調査を依頼し、「事例調査を開始しました」と返します。

3. **結果を取得する**

   1〜2 分ほど待ってから、「結果を教えて」「事例の結果は？」と入力します。Claude が結果を取得し、軸別件数・サマリーと **CSV のダウンロード URL** を表示します。

4. **CSV をダウンロードする**

   表示された URL を**ブラウザで開く**と、CSV がダウンロードされます。
   - `RESEARCH_AGENT_API_KEY` が有効な場合は、クリック用の **短命トークン付き URL** が発行されます（有効期限は約 10 分）。
   - Claude が URL をプログラムで取得しようとすると失敗することがあるため、必ずブラウザで開いてください。

---

## 管理者向け最小設定（Render + Inngest）

### Render（Express サーバー側）
- `OPENAI_API_KEY`（必須）
- `SERPER_API_KEY`（必須）
- `APP_URL`（必須）
- `INNGEST_EVENT_KEY`（必須 / Inngest Cloud へイベント送信に使う）
- `INNGEST_SIGNING_KEY`（必須 / Inngest Cloud が `/api/inngest` を呼ぶ時の検証用）
- `DATABASE_URL`（任意 / 設定すると RunState が Postgres に永続化され、再起動や再デプロイ後も結果が残りやすい）
- 使いたいなら認証: `RESEARCH_AGENT_API_KEY`（任意）、`RESEARCH_AGENT_REQUIRE_CLIENT_ID`（任意）

### Inngest Cloud（バックグラウンド実行）
- Serve URL: `https://<あなたのRenderのドメイン>/api/inngest`
- Event/Signing key は上記 Render 側の環境変数に設定（ドキュメントは `docs/DEPLOY.md`）

### もし「CSV URL が開けない」場合の典型
- `RESEARCH_AGENT_API_KEY` を有効にしているが、MCP 側に同じ値が入っていない
- `RESEARCH_AGENT_REQUIRE_CLIENT_ID=true` で、MCP 側に `RESEARCH_AGENT_CLIENT_ID` が入っていない
- CSV URL の有効期限切れ（短命トークン：約 10分）。その場合は再度「結果を教えて」で新しい URL を発行します。

---
## 運用台帳（最小）

調査・失敗・コスト増などのとき、最初に見る場所がすぐ分かるようにします。

### 外部サービス台帳（例）

| サービス名 | 用途 | ログインURL | 見るもの | 障害/確認のポイント |
|---|---|---|---|---|
| OpenAI API | LLM（軸/カテゴリ、クエリ生成、選別・構造化） | https://platform.openai.com/ | Usage / API Keys | 失敗・課金増：Usage とエラー内容 |
| Serper | Web検索URL取得 | https://serper.dev/ | API Keys / Usage | 403/レート制限/検索失敗：キーとUsage |
| Render | Express サーバー実行 / 環境変数 | https://dashboard.render.com/ | Service Logs / Environment | 失敗：Logs（HTTP 401/500）と Env（APP_URL 等） |
| Inngest | バックグラウンド実行（関数ステップ） | https://app.inngest.com/ | Runs / Events / Serve URL | run が出ない/止まる：どの step で失敗したか |
| GitHub | ソース管理（push/PR） | https://github.com/ | Actions / Commits / PR | デプロイされない：push先ブランチと Auto-Deploy |
| npm | MCP セットアップパッケージ配布 | https://www.npmjs.com/ | Package versions / README | 配布版の内容ずれ：最新バージョンと公開状態 |
| Claude Desktop | MCP クライアント（ユーザー側） | https://claude.ai/download | MCP 設定ファイル | MCP 設定漏れ：`RESEARCH_AGENT_SERVER_URL` / `RESEARCH_AGENT_API_KEY` / `RESEARCH_AGENT_CLIENT_ID` |

---

## 課金について

**有料になるのは次の 2 つです。**

| 項目 | 用途 | 備考 |
|------|------|------|
| **OPENAI_API_KEY** | 軸・カテゴリ、検索クエリ、選別・構造化（gpt-4o-mini） | 従量課金 |
| **SERPER_API_KEY** | Web 検索（Serper.dev） | 従量課金 |

Inngest は無料枠あり。RunState を Postgres に保存する場合は、Render Postgres 等の DB 利用料が別途かかります。

---

## デプロイ・他端末での利用

- **管理者（Render + Inngest Cloud の設定）**
  - Render の Web Service に `OPENAI_API_KEY`, `SERPER_API_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `APP_URL` を設定
  - Inngest Cloud の Serve URL を `https://<Renderドメイン>/api/inngest` に設定
- **利用者（Claude Desktop から使う）**
  - デプロイ済みサーバー URL が分かれば、MCP をセットアップするだけで利用できます
    - `npx -y --package=research-agent-mcp@latest -- research-agent-mcp-setup --url=https://<あなたのRenderのURL>`

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
│       ├── search.ts       # Web 検索（Serper.dev）
│       ├── fetch-html.ts   # HTML 取得
│       ├── html-to-json.ts # HTML → タイトル・見出し・本文
│       ├── screen-structure.ts  # 選別・構造化（LLM + Zod）
│       ├── run-store.ts    # RunState の読み書き（DB or ファイル）
│       ├── db.ts           # Postgres 接続・run_states 操作
│       └── ...
├── packages/mcp/           # npm パッケージ `research-agent-mcp`（利用時は `@latest` 推奨）
├── docs/                   # QUICKSTART, DEPLOY, STATUS 等
├── .env.example
└── README.md
```

---

## ライセンス

MIT
