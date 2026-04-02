# 事例調査エージェント (Research Agent)

Claude Desktop から「事例調査をして」「〇〇の事例を調べて」と依頼すると、バックグラウンドで Web 検索・選別・構造化を行い、**サマリーと CSV ダウンロード URL** で結果を返すエージェントです。

---

## 目次

- [できること](#できること)
- [使用の流れ](#使用の流れ)
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
- **結果の取得**: 完了後、Claude に「結果を教えて」と依頼すると、軸別件数・サマリーと **CSV ダウンロード用 URL** を表示。CSV はブラウザで URL を開くとダウンロード可能

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

   表示された URL を**ブラウザで開く**と、CSV がダウンロードされます（Claude 内で URL を取得すると失敗するため、必ずブラウザで開いてください）。

---

## 設定

### 環境変数（主要なもの）

| 変数 | 必須 | 説明 |
|------|------|------|
| `OPENAI_API_KEY` | ✅ | OpenAI API キー（gpt-4o-mini 用） |
| `SERPER_API_KEY` | ✅ | Web 検索 API キー（Serper.dev） |
| `APP_URL` | ✅ 本番 | アプリの URL（Inngest 用）。開発: `http://localhost:3000` |
| `DATABASE_URL` | — | Postgres の接続文字列。設定すると RunState を DB に保存（本番推奨） |
| `RESEARCH_AGENT_API_KEY` | — | 設定すると `/api/cases/search` と `/api/runs/*` に API キー必須。MCP の env にも同じ値を設定 |
| `RESEARCH_AGENT_REQUIRE_CLIENT_ID` | — | `true` のとき `X-Client-Id`（MCP では `RESEARCH_AGENT_CLIENT_ID`）必須。利用者ごとの Run を分離する |
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

## 運用台帳（最小）

OpenAI / Serper / Render / Inngest などの外部サービスは、まとめて **「外部サービス台帳」** として管理するのがおすすめです。  
迷ったときにすぐ参照できるよう、スプレッドシートは次の 2 シートだけで十分です。

### 1) 外部サービス台帳

| 項目 | 例 |
|------|----|
| サービス名 | OpenAI / Serper / Render / Inngest / GitHub / npm |
| 用途 | LLM / Web検索 / ホスティング / ジョブ実行 / ソース管理 / パッケージ配布 |
| ログイン URL | 各ダッシュボード URL |
| どこを見るか | API Keys / Usage / Logs / Runs / Deploys |
| 異常時の症状 | 401 / fetch failed / run stuck など |
| 最初の確認先 | `/health`, Render Logs, Inngest Runs など |
| 管理者 | 担当者名 |
| 最終確認日 | YYYY-MM-DD |

### 2) 認証情報台帳（値は書かない）

| 項目 | 例 |
|------|----|
| 種別 | OPENAI_API_KEY / SERPER_API_KEY / RESEARCH_AGENT_API_KEY / RESEARCH_AGENT_CLIENT_ID |
| 発行場所 | OpenAI / Serper / 自前生成（サーバー運用） |
| 設定先 | Render env / Claude Desktop MCP env / local `.env` |
| 必須か | 必須 / 任意 |
| 生成・更新手順リンク | この README の該当節や社内手順書 |
| ローテーション日 | YYYY-MM-DD |
| 失効日（任意） | YYYY-MM-DD |
| 管理者 | 担当者名 |

`RESEARCH_AGENT_API_KEY` や各 API キーの**値そのものは台帳に記載しない**でください。値は 1Password などのシークレットマネージャーで管理します。

### APIキー / Client ID の発行方法（最小）

- `OPENAI_API_KEY`: [OpenAI dashboard](https://platform.openai.com/api-keys) で作成し、`OPENAI_API_KEY` に設定
- `SERPER_API_KEY`: [Serper dashboard](https://serper.dev/) で発行し、`SERPER_API_KEY` に設定
- `RESEARCH_AGENT_API_KEY`（自前）: サーバー保護用の共有キー。例: `openssl rand -hex 32` で生成し、サーバー側と MCP 側の両方に同じ値を設定
- `RESEARCH_AGENT_CLIENT_ID`（自前）: 利用者識別子。UUID 形式を推奨。例: `uuidgen`（macOS）で生成した値を設定

最終確認は `GET /health`（要件確認）と `GET /api/verify`（認証確認）で行えます。

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

- **サーバーをデプロイして他端末の Claude から使う**: [docs/DEPLOY.md](docs/DEPLOY.md) に、Render・Inngest Cloud・環境変数・他端末の MCP 設定を記載しています。
- **利用者**: デプロイ済みサーバー URL があれば、[使い方（本番環境）](#使い方本番環境) のとおり `npx ... research-agent-mcp-setup` で MCP を追加するだけで利用できます（リポジトリのクローン不要）。
- **ローカルで開発・検証したい場合**: [docs/QUICKSTART.md](docs/QUICKSTART.md) を参照してください。

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
