# 事例調査エージェント (Research Agent)

Claude Desktop から「事例調査をして」「〇〇の事例を調べて」と依頼すると、バックグラウンドで Web 検索・選別・構造化を行い、結果を**サマリーと CSV ダウンロード URL**で返すエージェントです。

## アーキテクチャ

- **Claude Desktop**: ユーザー入力と結果表示
- **MCP (stdio)**: `search_cases` / `get_case_study_result` ツールで Claude とバックエンドを接続
- **Express + Inngest**: ジョブ投入とフェーズ 5〜12 の実行（軸生成・検索・HTML 取得・選別・補充・重複フラグ）
- **結果**: 完了時は RunState を DB（`DATABASE_URL` 設定時）または `DATA_DIR` に保存。CSV は `GET /api/runs/:runId/csv` で配布。ローカル運用時のみ MCP が Excel を生成可能。

## 課金について

**有料になるのは次の2つです。**

| 項目 | 用途 | 備考 |
|------|------|------|
| **OPENAI_API_KEY** | 軸・カテゴリ生成、検索クエリ生成、選別・構造化（gpt-4o-mini） | 従量課金 |
| **SERPER_API_KEY** | Web 検索（[Serper.dev](https://serper.dev/)） | 従量課金（SERPAPI_API_KEY も互換で利用可） |

その他（Inngest・Node/Express・ExcelJS・axios/cheerio）は無料枠または無料です。RunState を Postgres に保存する場合は `DATABASE_URL` 用の DB が必要です（Render Postgres 等）。

---

## 料金・トークンを抑える設定（初期おすすめ）

デフォルトは **LIGHT_MODE** 有効で、件数を少なめにしています。

| 項目 | 少なめ（LIGHT_MODE=true） | 本番向け（LIGHT_MODE=false） |
|------|---------------------------|------------------------------|
| 目標事例数 | 10件 | 100件 |
| 軸の数 | 2 | 5 |
| 軸あたりカテゴリ | 2 | 5 |
| カテゴリあたり検索件数 | 2〜3件 | 5〜7件 |
| 件数補充 | なし（0回） | 最大3回 |

本番のように多くしたい場合は `.env` に `LIGHT_MODE=false` を入れ、必要なら `MAX_CASES_TARGET` / `MAX_AXES` / `MAX_CATEGORIES_PER_AXIS` / `SEARCH_PER_CATEGORY_MIN` / `SEARCH_PER_CATEGORY_MAX` / `MAX_SUPPLEMENT_ROUNDS` などで細かく調整できます。詳細は `.env.example` を参照してください。

---

## 使える状態にするには

- **クラウドサーバーをそのまま使う（推奨）**: デプロイ済みサーバー URL があれば、**ローカルにリポジトリを置かず**に [npm パッケージ](packages/mcp/README.md) のセットアップコマンドで MCP を追加できます。  
  ```bash
  npx -y -p research-agent-mcp research-agent-mcp-setup --url=https://research-agent-ehck.onrender.com
  ```
- **自分の PC だけで使う（ローカル開発）**: [docs/QUICKSTART.md](docs/QUICKSTART.md)（API キー → 2 ターミナル起動 → MCP 設定）
- **サーバーに載せて他の人にも使わせる**: [docs/DEPLOY.md](docs/DEPLOY.md)（Render・Inngest Cloud・環境変数・他端末の MCP 設定）

---

## セットアップ（詳細）

### 1. 依存関係

```bash
npm install
```

### 2. 環境変数

`.env` を用意（`.env.example` をコピーして編集）。

| 変数 | 説明 |
|------|------|
| `OPENAI_API_KEY` | OpenAI API キー（軸生成・検索クエリ・選別・構造化で gpt-4o-mini を使用） |
| `SERPER_API_KEY` | Serper.dev の Web 検索 API キー（未設定時は `SERPAPI_API_KEY` も参照） |
| `DATA_DIR` | 実行状態の保存先（省略時: `./data`）。`DATABASE_URL` 設定時は RunState は DB に保存 |
| `OUTPUT_DIR` | Excel の保存先（省略時: `./output`）。ローカルで Excel を出す場合のみ |
| `APP_URL` | このアプリの URL（Inngest 用。開発時: `http://localhost:3000`） |
| `DATABASE_URL` | 任意。Postgres の接続文字列。設定すると RunState を DB に保存し、再起動後も結果が残る（本番推奨） |

その他、`LIGHT_MODE`・`MAX_AXES`・`MAX_CASES_TARGET` などは `.env.example` を参照してください。

### 3. 起動（ローカル開発時）

**ターミナル 1: Express + Inngest エンドポイント**

```bash
npm run dev
```

**ターミナル 2: Inngest Dev Server（ジョブ実行）**

```bash
npm run inngest:dev
```

Inngest のデフォルトは `http://localhost:8288` です。イベントはここに送られ、Dev Server が `APP_URL` の `/api/inngest` に転送して関数を実行します。

**Claude Desktop: MCP 設定**

- **クラウドサーバーを使う場合**: 上記の `npx ... research-agent-mcp-setup` を実行するか、[packages/mcp/README.md](packages/mcp/README.md) の手動設定に従い、`RESEARCH_AGENT_SERVER_URL` を設定します。
- **ローカルのみ**: Claude Desktop の MCP 設定に、このリポジトリの MCP サーバーを追加します。
  - **コマンド**: `npx`
  - **引数**: `["tsx", "/path/to/research-agent/src/mcp-server.ts"]`（`src/mcp-server.ts` の**絶対パス**）
  - **環境変数**: `DATA_DIR` / `OUTPUT_DIR` を、Express を動かしているマシンと同じパスにすると、結果を同じディレクトリで共有できます。

例（開発時、tsx で実行）:

```json
{
  "mcpServers": {
    "research-agent": {
      "command": "npx",
      "args": ["tsx", "/Users/you/code/research-agent/src/mcp-server.ts"],
      "env": {
        "DATA_DIR": "/Users/you/code/research-agent/data",
        "OUTPUT_DIR": "/Users/you/code/research-agent/output"
      }
    }
  }
}
```

## 使い方

1. Claude Desktop で「〇〇の事例を調査して」「ケーススタディをまとめて」などと入力
2. Claude が `search_cases` を呼び、「事例調査を開始しました」と返す
3. 1〜2 分待ってから「結果を教えて」と入力
4. Claude が `get_case_study_result` を呼び、サマリーと **CSV のダウンロード URL** を表示。CSV は**ユーザーがブラウザでその URL を開くとダウンロード**されます（Claude が URL を取得すると失敗するため、案内文で「ブラウザで開く」旨が含まれています）。

## 技術スタック

- **Node.js / TypeScript** (ESM)
- **MCP**: `@modelcontextprotocol/sdk` (stdio)
- **Inngest**: バックグラウンド処理・ステップ・リトライ
- **LLM**: OpenAI **gpt-4o-mini**（軸・カテゴリ、検索クエリ、選別・構造化）。Zod で JSON 形式を検証
- **Web 検索**: **Serper.dev**（`SERPER_API_KEY`）。未設定時は `SERPAPI_API_KEY` も参照
- **HTML 取得**: axios / cheerio（HTML→JSON、文字数制限あり）
- **結果**: RunState を Postgres（`DATABASE_URL`）またはファイルに保存。CSV は API でその場生成。ローカル時は ExcelJS で Excel 出力可能

## ライセンス

MIT
