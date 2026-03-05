# MCP の npm パッケージ化計画

誰でも「リポジトリをクローンせず」同じ設定で事例調査 MCP を使えるようにするための計画です。

---

## 1. 目的と方針

- **目的**: Claude Desktop の設定を `npx research-agent-mcp` と `RESEARCH_AGENT_SERVER_URL` だけにし、**パスを書かずに**誰でも同じように使えるようにする。
- **方針**: **リモート専用**の MCP クライアントを 1 パッケージとして公開する。
  - デプロイ済みサーバー（例: Render）に HTTP で話すだけの薄いクライアントにする。
  - ローカル開発（`RESEARCH_AGENT_SERVER_URL` 未設定でファイル・Inngest を直接使う）は、従来どおりこのリポジトリをクローンして `npm run mcp:dev` などで動かす想定。

---

## 2. パッケージ構成

### 2.1 名前・配置

| 項目 | 案 |
|------|-----|
| **パッケージ名** | `research-agent-mcp`（npm で未使用ならそのまま、使用中なら `@<scope>/research-agent-mcp`） |
| **配置** | このリポジトリ内 **`packages/mcp/`**（モノレポ 1 パッケージ）。本家の API 変更と同時に MCP クライアントを更新しやすい。 |

### 2.2 含めるもの

- **リモート専用の MCP サーバー**（stdio）
  - ツール: `search_cases`（`POST /api/cases/search`）、`get_case_study_result`（`GET /api/runs/latest`, `GET /api/runs/:runId`）
  - 環境変数: `RESEARCH_AGENT_SERVER_URL`（必須）、`RESEARCH_AGENT_API_KEY`（任意）
- **依存**: `@modelcontextprotocol/sdk`、`zod` のみ（と `dotenv` は任意で読み込み）
- **ビルド**: TypeScript → `dist/` に JS を出力し、`node dist/mcp-server.js` で実行可能にする（tsx 不要）

### 2.3 含めないもの

- ローカルモード（Inngest 直接送信、`DATA_DIR` 読み、Excel 生成）は **含めない**。利用者は「デプロイされたサーバー URL を指定する」前提にする。
- 本家の `express` / `inngest` / `pg` / `anthropic` / `serpapi` 等は MCP クライアントでは不要。

---

## 3. 実装の進め方

### 3.1 新規作成するファイル（`packages/mcp/` 想定）

```
packages/mcp/
├── package.json       # name: "research-agent-mcp", bin を 2 つ（mcp 本体 + setup）
├── tsconfig.json      # ESM, outDir: dist
├── src/
│   ├── mcp-server.ts  # リモート専用（fetch のみ、型は最小限の interface）
│   └── setup.ts       # 1コマンドセットアップ用（Claude 設定に MCP を追加）
├── README.md          # 使い方・「まず npx research-agent-mcp-setup」を冒頭に
└── .env.example       # 任意
```

### 3.2 `packages/mcp/src/mcp-server.ts` の内容（概要）

- 現在の [src/mcp-server.ts](../src/mcp-server.ts) から **リモート用の処理だけ**を抜き出す:
  - `SERVER_URL` が未設定なら起動時または初回ツール呼び出し時に「RESEARCH_AGENT_SERVER_URL を設定してください」と返す。
  - `search_cases` → `POST ${SERVER_URL}/api/cases/search` のみ。
  - `get_case_study_result` → `GET ${SERVER_URL}/api/runs/latest` と `GET ${SERVER_URL}/api/runs/:runId` のみ。返答の文言（実行中は連続呼び出ししない旨など）は本家と同じにしておく。
- RunState 等の型は、必要なプロパティだけをパッケージ内で interface として定義（本家の `types.ts` に依存しない）。

### 3.3 package.json（案）

```json
{
  "name": "research-agent-mcp",
  "version": "1.0.0",
  "description": "MCP server for research-agent (case study search). Connect to a deployed research-agent server.",
  "type": "module",
  "main": "dist/mcp-server.js",
  "bin": {
    "research-agent-mcp": "./dist/mcp-server.js",
    "research-agent-mcp-setup": "./dist/setup.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.4",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "@types/node": "^22.0.0"
  },
  "engines": { "node": ">=18" }
}
```

- `dotenv`: 任意。入れるなら `dependencies` に追加し、先頭で `import "dotenv/config"` する。

### 3.4 本家リポジトリとの関係

- **本家の `src/mcp-server.ts`** はそのまま残し、ローカル開発・フル機能用として利用する。
- **packages/mcp** は「公開用のリモート専用クライアント」。本家の API（エンドポイント・レスポンス形）が変わったら、ここを合わせて更新する。
- ルートの `package.json` で npm workspaces を使う場合: `"workspaces": ["packages/*"]` を追加し、ルートで `npm install` すると `packages/mcp` も扱えるようにする（任意）。

---

## 4. 簡単セットアップ（1コマンドでできるだけ減らす）

初めて使う人の手順を **1 コマンド + URL 入力** に近づけるため、**セットアップ用コマンド** を用意する。

### 4.1 やり方（想定）

1. Node.js が入っていることを確認（`node -v`）
2. ターミナルで実行:
   ```bash
   npx research-agent-mcp-setup
   ```
3. プロンプトで **サーバー URL** を入力（例: `https://xxx.onrender.com`）。API キーが必要なサーバーなら、同じタイミングで入力できるようにする（任意）。
4. スクリプトが **Claude Desktop の設定ファイル** を探して、`mcpServers.research-agent` を追加または上書きする。
5. 表示に従って **Claude Desktop を再起動** する。

これで「設定ファイルを自分で開く」「JSON を書き写す」は不要にする。

### 4.2 セットアップスクリプト（setup.ts）の動き

- **設定ファイルの場所**（一般的な例）:
  - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
  - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- **やること**:
  1. 上記パスにファイルがあれば読み、なければ `{}` から開始。
  2. `mcpServers` がなければ作る。`mcpServers.research-agent` を、入力された URL（と API キー）で設定。
  3. 既存の他の MCP サーバーは **消さずにマージ**する。
  4. ファイルを書き戻す。
  5. 「設定を追加しました。Claude Desktop を再起動してください。」と表示。
- **対話**: 標準入力で URL を聞く（readline や prompts は使わず、簡単な `console.log` + `createInterface` で十分）。非対話モード（引数で URL を渡す）も用意すると、自動化しやすい（例: `npx research-agent-mcp-setup --url https://...`）。

### 4.3 フォールバック

- 設定ファイルが見つからない・書き込めない場合は、「手動で設定してください」と案内し、**従来どおりの設定例**（README の JSON ブロック）を表示する。

---

## 5. 初めて使う人が設定すること

### 5.1 サーバーを「使うだけ」の人（自分ではデプロイしない）— 簡単コース

- **Node.js** が入っていること（npx 用。18 以上推奨）。
- ターミナルで **1 コマンド**: `npx research-agent-mcp-setup` → URL を聞かれたら入力 → Claude Desktop を再起動。
- リポジトリのクローン・設定ファイルの手編集は**不要**。

### 5.2 手動で設定する場合（従来どおり）

- **Claude Desktop** の MCP 設定で次を追加:
  - `command`: `npx`
  - `args`: `["research-agent-mcp"]`
  - `env`: **`RESEARCH_AGENT_SERVER_URL`** にサーバー URL。必要なら **`RESEARCH_AGENT_API_KEY`**。

### 5.3 自分でサーバーをデプロイして使う人

- 上記に加え、**サーバー側の準備**（[DEPLOY.md](DEPLOY.md) のとおり）が必要:
  - Render などに Web サービスをデプロイ
  - Inngest Cloud の設定、環境変数（API キー、`DATABASE_URL` など）
- デプロイ後に発行された URL を、自分の Claude 設定の `RESEARCH_AGENT_SERVER_URL` に入れる。

---

## 6. 制限される機能について

**npx research-agent-mcp で使う場合、サーバーに話す機能は本家と同じです。**

| 機能 | npx パッケージ | 備考 |
|------|----------------|------|
| 調査の開始（search_cases） | ✅ 同じ | POST /api/cases/search を呼ぶ |
| 結果の取得（get_case_study_result） | ✅ 同じ | GET /api/runs/latest, /api/runs/:runId を呼ぶ |
| サマリー・CSV URL の案内 | ✅ 同じ | サーバーが返す内容をそのまま返す |
| **ローカルモード**（サーバー URL なしでファイル・Inngest 直接） | ❌ 使えない | パッケージは「リモート専用」。ローカルで全部動かす場合はリポジトリをクローンして `npm run mcp:dev` を使う |

まとめ: **デプロイ済みサーバーに接続して使う限り、制限される機能はない。**「自分 PC 上だけでサーバーを立てずに開発・検証したい」だけ、本家リポジトリが必要。

---

## 7. 利用者向けドキュメント（README.md に書く内容）

- **必要なもの**: Node.js 18+, デプロイ済み research-agent サーバーの URL
- **まず試してほしいこと（簡単）**: `npx research-agent-mcp-setup` を実行し、表示に従って URL を入力して Claude Desktop を再起動。
- **手動で設定する場合**の例:
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
- **注意**: サーバー側で API キーを要求している場合は、上記 `RESEARCH_AGENT_API_KEY` を同じ値に設定する。

---

## 8. 公開手順

1. **npm アカウント**でログイン: `npm login`
2. **パッケージ名の確認**: `npm search research-agent-mcp` で未使用か確認。使用中ならスコープ付き（例: `@yourusername/research-agent-mcp`）で package.json の `name` を設定。
3. **ビルド**: `cd packages/mcp && npm run build`
4. **公開**: `npm publish`（スコープ付きの場合は `npm publish --access public`）
5. **本家 docs**（[DEPLOY.md](DEPLOY.md) など）に「誰でも使う場合」として、上記 npx 設定とパッケージ名を追記する。

---

## 9. タスク一覧（実装時のチェックリスト）

- [ ] リポジトリに `packages/mcp/` を作成
- [ ] `packages/mcp/package.json` を上記のとおり作成（bin に mcp と setup の 2 つ）
- [ ] `packages/mcp/tsconfig.json` を追加（ESM, dist 出力）
- [ ] `packages/mcp/src/mcp-server.ts` を実装（リモート専用、型は最小限）
- [ ] `packages/mcp/src/setup.ts` を実装（Claude 設定ファイルの検出・マージ・書き戻し、URL 対話入力）
- [ ] `packages/mcp/README.md` に使い方（**まず npx research-agent-mcp-setup**）と手動設定例を記載
- [ ] `npm run build` でビルドが通ることを確認
- [ ] ローカルで MCP 本体と setup の両方を動作確認（macOS / Windows どちらかでよい）
- [ ] （任意）ルートで npm workspaces を有効化
- [ ] npm に publish
- [ ] 本家 DEPLOY.md / QUICKSTART.md に「npx research-agent-mcp-setup で簡単セットアップ」を追記

---

## 10. 今後の拡張（任意）

- **ローカルモードのサポート**: パッケージに「サーバー URL 未設定時はローカルで Inngest / ファイルを参照」を持たせる場合は、依存が増えるため別パッケージ（例: `research-agent-mcp-full`）や、オプションで重い依存を読み込む形を検討。
- **バージョン**: 本家の API の破壊的変更があれば、パッケージのメジャーバージョンを上げる。
