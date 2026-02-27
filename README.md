# 事例調査エージェント (Research Agent)

Claude Desktop から「事例調査をして」と依頼すると、バックグラウンドで Web 検索・選別・構造化を行い、結果を Excel とサマリーで返すエージェントです。

## アーキテクチャ

- **Claude Desktop**: ユーザー入力と結果表示
- **MCP (stdio)**: `search_cases` / `get_case_study_result` ツールで Claude とバックエンドを接続
- **Express + Inngest**: ジョブ投入とフェーズ 5〜12 の実行（軸生成・検索・HTML 取得・選別・補充・重複フラグ・Excel 出力）
- **ファイル**: 実行状態と Excel は `DATA_DIR` / `OUTPUT_DIR` に保存（DB なし）

## 課金について

**有料になるのは次の2つだけです。**

| 項目 | 用途 | 備考 |
|------|------|------|
| **ANTHROPIC_API_KEY** | 軸・カテゴリ生成、検索クエリ生成、選別・構造化（Claude） | 従量課金 |
| **SERPAPI_API_KEY** | Web検索（SerpAPI） | 従量課金 |

その他（Inngest・Node/Express・ExcelJS・axios/cheerio・DBなし）は無料です。Inngest は無料枠があります。

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

本番のように多くしたい場合は `.env` に `LIGHT_MODE=false` を入れ、必要なら `MAX_CASES_TARGET=100` なども設定してください。

---

## 使える状態にするには

- **自分の PC だけで使う**: [docs/QUICKSTART.md](docs/QUICKSTART.md)（API キー → 2ターミナル起動 → MCP 設定）
- **サーバーに載せて他の人にも使わせる**: [docs/DEPLOY.md](docs/DEPLOY.md)（デプロイ手順・他端末の MCP 設定）

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
| `ANTHROPIC_API_KEY` | Anthropic API キー（軸生成・検索クエリ・選別・構造化で使用） |
| `SERPAPI_API_KEY` | SerpAPI キー（Web 検索） |
| `DATA_DIR` | 実行状態の保存先（省略時: `./data`） |
| `OUTPUT_DIR` | Excel の保存先（省略時: `./output`） |
| `APP_URL` | このアプリの URL（Inngest 用。開発時: `http://localhost:3000`） |

### 3. 起動

**ターミナル 1: Express + Inngest エンドポイント**

```bash
npm run dev
```

**ターミナル 2: Inngest Dev Server（ジョブ実行）**

```bash
npm run inngest:dev
```

Inngest のデフォルトは `http://localhost:8288` です。イベントはここに送られ、Dev Server が `APP_URL`（例: `http://localhost:3000`）の `/api/inngest` に転送して関数を実行します。

**Claude Desktop: MCP 設定**

Claude Desktop の MCP 設定に、このリポジトリの MCP サーバーを追加します。

- **コマンド**: `node` または `tsx`
- **引数**: ビルド済みなら `dist/mcp-server.js`、開発なら `src/mcp-server.ts` の**絶対パス**
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

1. Claude Desktop で「〇〇の事例を調査して」などと入力
2. Claude が `search_cases` を呼び、「調査を開始しました」と返す
3. 完了したら「結果を教えて」と入力
4. Claude が `get_case_study_result` を呼び、サマリーと Excel のパスを表示

## 技術スタック

- **Node.js / TypeScript** (ESM)
- **MCP**: `@modelcontextprotocol/sdk` (stdio)
- **Inngest**: バックグラウンド処理・ステップ・リトライ
- **Claude**: Sonnet（軸・カテゴリ、表示用）/ Haiku（検索クエリ、選別・構造化）
- **Web 検索**: SerpAPI
- **HTML 取得**: axios / cheerio（HTML→JSON、3000 文字制限）
- **Excel**: ExcelJS（サマリー＋軸別シート）

## ライセンス

MIT
