# 実装手順 Todo

事例調査エージェントを**ゼロから本番デプロイまで**の実装手順を細分化したチェックリストです。  
どこまで完了しているかは各項目の `[x]` / `[ ]` で判断できます。

---

## 現在の段階（要約）

- **完了**: 1〜7 の本番デプロイまで（Render デプロイ・Inngest Cloud・E2E 動作確認済み）
- **未実施**: オプションの「Inngest 完了時に Excel を生成」、8 の「今後の検討」（DB 保存・マルチテナント等）

下のチェックリストで **最初に `[ ]` になっている項目** が「これからやるべき段階」です。

---

## 1. プロジェクト基盤

- [x] プロジェクト初期化（package.json, type: "module", TypeScript）
- [x] 依存関係の追加（express, inngest, @anthropic-ai/sdk, @modelcontextprotocol/sdk, axios, cheerio, exceljs, serpapi, zod, dotenv）
- [x] tsconfig（ESM 出力、dist 配下）
- [x] npm scripts: build, dev, mcp, mcp:dev, inngest:dev
- [x] .env.example の用意
- [x] .gitignore（node_modules, .env, data, output）

---

## 2. 型・設定

- [x] 型定義（types.ts）: RunState, Axis, CaseItem, SearchResultItem 等
- [x] config.ts: DATA_DIR, OUTPUT_DIR, APP_URL, API キー、LIGHT_MODE
- [x] LIGHT_MODE による件数・軸数・カテゴリ数・補充回数の切り替え
- [x] getRunStatePath / getExcelPath のユーティリティ

---

## 3. ライブラリ（検索・HTML・構造化）

- [x] SerpAPI 検索（lib/search.ts）: searchWeb(query, lang)
- [x] HTML 取得（lib/fetch-html.ts）: fetchHtmlBatch, 文字数制限
- [x] HTML→構造化（lib/html-to-json.ts）: htmlToStructuredJson
- [x] 軸・カテゴリ生成（lib/axes.ts）: generateAxesAndCategories（Claude）
- [x] 検索クエリ生成（lib/queries.ts）: categoryToSearchQueries（Claude）
- [x] 選別・構造化（lib/screen-structure.ts）: screenAndStructure（Claude）
- [x] 重複フラグ（lib/dedup.ts）: flagDuplicates
- [x] RunState 読み書き（lib/run-store.ts）: readRunState, writeRunState
- [x] Excel 出力（lib/excel.ts）: writeExcel（オプション・Inngest では未使用）

---

## 4. Inngest

- [x] Inngest クライアント（inngest/client.ts）: APP_URL 等
- [x] caseStudySearch: イベント "cases/search"、runId, query
- [x] Step: generate-axes（軸・カテゴリ）
- [x] Step: generate-queries（全軸・カテゴリのクエリ）
- [x] Step: search-web（SerpAPI 並列）
- [x] Step: fetch-and-screen（HTML 取得 + 選別・構造化、1 step に集約）
- [x] Step: save-initial-state（RunState 書き出し）
- [x] cases/supplement イベント送信
- [x] caseStudySupplement: イベント "cases/supplement"
- [x] 不足カテゴリの特定・補充検索・マージ・finalize
- [x] 完了時は writeRunState のみ（Excel は書かない）
- [ ] （オプション）完了時に Excel を生成して OUTPUT_DIR に保存

---

## 5. サーバー（Express）

- [x] Express アプリ、express.json()
- [x] POST /api/cases/search: runId 生成、inngest.send("cases/search"), 202 + runId
- [x] /api/inngest に serve({ client, functions })
- [x] GET /api/runs/latest: 直近 runId
- [x] GET /api/runs/:runId: RunState JSON
- [x] GET /api/runs/:runId/csv: RunState から CSV をその場生成
- [x] GET /api/runs/:runId/excel: ファイルが存在する場合のみ配布
- [x] GET /health
- [x] RESEARCH_AGENT_API_KEY がある場合の checkApiKey ミドルウェア

---

## 6. MCP

- [x] MCP サーバー（stdio）、名前・バージョン
- [x] ツール search_cases: query を受け取り調査開始
- [x] リモート時: POST /api/cases/search を呼ぶ
- [x] ローカル時: inngest.send("cases/search") を呼ぶ
- [x] ツール get_case_study_result: runId 省略時は直近取得
- [x] リモート時: GET /api/runs/:runId、GET /api/runs/latest、結果は CSV URL で案内（ブラウザで開いてダウンロードする旨を明記し、URL の取得は行わないよう案内）
- [x] ローカル時: readRunState、必要なら writeExcel して file:// で案内
- [x] 状態に応じたメッセージ（running / completed / failed）

---

## 7. デプロイ・ドキュメント

- [x] Dockerfile（Node ビルド・実行）
- [x] .dockerignore
- [x] docs/DEPLOY.md: 共通環境変数、Render/Railway/Fly/Docker の手順
- [x] 完全クラウド移行の説明（イベントはサーバーだけ、MCP に INNGEST_EVENT_KEY を入れない）
- [x] バックグラウンドの動きの説明
- [x] docs/QUICKSTART.md: ローカル 2 ターミナル、MCP 設定
- [x] docs/STATUS.md: 全体フローと現状サマリー
- [x] docs/IMPLEMENTATION_TODO.md: 本ファイル（実装手順の細分化）
- [x] Render（または他 PaaS）へ実際にデプロイし、Inngest Cloud の Serve URL を設定
- [x] 本番で 1 回以上 E2E 動作確認（Claude → 調査開始 → 結果・CSV 取得）

---

## 8. 今後の検討（任意）

- [x] RunState を DB に保存（`DATABASE_URL` 設定時は Postgres に保存。未設定時は従来どおりファイル）
- [ ] 認証・マルチテナント（複数ユーザー・API キー管理）
- [ ] Inngest 完了時に Excel も生成するオプション

---

## 使い方

- 実装を進めるときは、**最初の `[ ]` から順に** 進めると流れが分かりやすいです。
- 完了したら該当行の `[ ]` を `[x]` に変更してください。
- 「現在どの段階か」は、**最初に `[ ]` になっている大項目（1〜8）と、その中の最初の未完了項目**で判断できます。
