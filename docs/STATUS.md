# 実装の段階：全体ステップと現状

事例調査エージェントの**全体の流れ（ステップ）と現在の実装状況**をまとめています。

> **実装手順の細分化 Todo** は [docs/IMPLEMENTATION_TODO.md](IMPLEMENTATION_TODO.md) にあります。  
> 「どの段階まで完了しているか」を項目ごとのチェックで追いたい場合はそちらを参照してください。

---

## 1. 全体のステップ（フロー）

### 1.1 ユーザー視点の流れ


| ステップ | 誰が     | 何をする                                                             |
| ---- | ------ | ---------------------------------------------------------------- |
| 1    | ユーザー   | Claude に「〇〇の事例を調査して」と依頼                                          |
| 2    | Claude | MCP の `search_cases` を呼ぶ                                         |
| 3    | MCP    | サーバーに `POST /api/cases/search` を送る（クラウド）または ローカルで `inngest.send` |
| 4    | サーバー   | `runId` を返す（202）。バックグラウンドで Inngest にイベント送信                       |
| 5    | ユーザー   | 1〜2分待って「結果を教えて」と依頼                                               |
| 6    | Claude | MCP の `get_case_study_result` を呼ぶ                                |
| 7    | MCP    | サーバーに `GET /api/runs/:runId` で状態取得。完了なら CSV URL を提示              |
| 8    | ユーザー   | サマリーと CSV ダウンロード URL を受け取る                                       |


---

### 1.2 バックエンド処理のフェーズ（Inngest 関数内）

設計上のフェーズと、現在の Inngest ステップの対応です。


| フェーズ | 内容       | 実装（Inngest step）                                                         |
| ---- | -------- | ------------------------------------------------------------------------ |
| 5    | 軸・カテゴリ生成 | `generate-axes`（Claude でクエリから軸とカテゴリを生成）                                  |
| 6    | 検索クエリ生成  | `generate-queries`（軸・カテゴリごとに日本語/英語クエリ）                                   |
| 7    | Web 検索   | `search-web`（SerpAPI で並列検索）                                              |
| 8    | HTML 取得  | `fetch-and-screen` 内で `fetchHtmlBatch`                                   |
| 9    | HTML→構造化 | 同上、`htmlToStructuredJson`                                                |
| 10   | 選別・構造化   | 同上、`screenAndStructure`（Claude で CaseItem に整形）                           |
| —    | 初回状態保存   | `save-initial-state`（RunState を `DATA_DIR/runs/<runId>.json` に保存）        |
| 11   | 件数補充     | `cases/supplement`：不足カテゴリを検索・選別・マージ（LIGHT_MODE 時は 0 回）                   |
| 12   | 重複フラグ・完了 | `flagDuplicates` 後、`writeRunState` で `status: "completed"`, `cases` のみ保存 |
| —    | Excel 出力 | **現状は未使用**。Inngest 側では Excel を書き出さず、RunState のみ。                         |


**出力**: 完了時は `DATA_DIR/runs/<runId>.json` に `status`, `query`, `axes`, `cases`, `completedAt` が入る。Excel ファイルは Inngest では作らない。

---

### 1.3 運用モード


| モード      | 条件                              | イベント送信                                      | 結果取得                                                 |
| -------- | ------------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| **ローカル** | `RESEARCH_AGENT_SERVER_URL` 未設定 | MCP が `inngest.send`（Inngest Dev または Cloud） | MCP が `DATA_DIR` の RunState を読む。必要なら MCP が Excel を生成 |
| **クラウド** | `RESEARCH_AGENT_SERVER_URL` 設定  | サーバーが `inngest.send`（Inngest Cloud のみ想定）    | MCP が `GET /api/runs/:runId` と CSV URL を利用           |


---

## 2. 現状サマリー

### 2.1 実装済み

- **MCP**  
  - `search_cases`：リモート時は `POST /api/cases/search`、ローカル時は `inngest.send`  
  - `get_case_study_result`：リモート時はサーバー API、ローカル時は RunState 読み＋必要時 Excel 生成
- **サーバー（Express）**  
  - `POST /api/cases/search`（runId 生成・Inngest 送信）  
  - `GET /api/inngest`（Inngest serve）  
  - `GET /api/runs/latest`  
  - `GET /api/runs/:runId`（RunState JSON）  
  - `GET /api/runs/:runId/csv`（RunState から CSV をその場生成）  
  - `GET /api/runs/:runId/excel`（ファイルが存在する場合のみ配布）  
  - `GET /health`
- **Inngest**  
  - `caseStudySearch`：軸生成→クエリ→検索→HTML 取得・選別・構造化→初回保存→`cases/supplement` 送信  
  - `caseStudySupplement`：不足カテゴリの追加検索・選別・マージ→重複フラグ→RunState 完了保存（Excel は書かない）
- **設定**  
  - `LIGHT_MODE`（デフォルト true）：軸2・カテゴリ2・目標10件・補充0回  
  - `MAX_CASES_TARGET`, `MAX_SUPPLEMENT_ROUNDS`, `maxAxes`, `maxCategoriesPerAxis`, `searchPerCategory`
- **デプロイ**  
  - Dockerfile / .dockerignore  
  - docs/DEPLOY.md（Render 等・完全クラウド移行・バックグラウンドの説明）  
  - docs/QUICKSTART.md（ローカル 2 ターミナル＋MCP 設定）

### 2.2 オプション・残存

- **Excel**  
  - `lib/excel.ts` と `GET /api/runs/:runId/excel` は残している。  
  - Inngest 側では Excel を生成しない。  
  - ローカル運用時のみ、MCP が結果取得時に `writeExcel` で生成し、`file://` で案内可能。
- **モデル**  
  - 軸・クエリ・選別は Sonnet（`claude-sonnet-4-5`）。Haiku は 404 のため未使用。

### 2.3 未実装・今後の検討

- DB による RunState 保存（現状はファイルのみ）  
- 認証・マルチテナント（現状は `RESEARCH_AGENT_API_KEY` の単一キー程度）  
- Inngest 以外のキュー（現状は Inngest 前提）

---

## 3. デプロイ状態の整理


| 項目         | 内容                                                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **完全クラウド** | Render にサーバーをデプロイし、Inngest Cloud の Serve URL を `https://<Render>/api/inngest` に設定。MCP は `RESEARCH_AGENT_SERVER_URL` のみ設定し、`INNGEST_EVENT_KEY` は持たない。 |
| **ローカル**   | `npm run dev` と `npm run inngest:dev` の 2 ターミナル。MCP は `DATA_DIR` / `OUTPUT_DIR` を設定。                                                                 |
| **永続化**    | RunState は `DATA_DIR`（例: `/app/data`）に保存。Render Free では再デプロイで消えるため、Persistent Disk または有料プラン推奨。                                                       |


---

## 4. 主要ファイル一覧


| 役割             | ファイル                                  |
| -------------- | ------------------------------------- |
| サーバー           | `src/server.ts`                       |
| MCP            | `src/mcp-server.ts`                   |
| Inngest 関数     | `src/inngest/functions/case-study.ts` |
| Inngest クライアント | `src/inngest/client.js`               |
| 設定             | `src/config.ts`                       |
| 型              | `src/types.ts`                        |
| 軸生成            | `src/lib/axes.js`                     |
| クエリ生成          | `src/lib/queries.js`                  |
| 検索             | `src/lib/search.js`                   |
| HTML 取得        | `src/lib/fetch-html.js`               |
| 選別・構造化         | `src/lib/screen-structure.js`         |
| 重複フラグ          | `src/lib/dedup.js`                    |
| RunState 読み書き  | `src/lib/run-store.js`                |
| Excel（オプション）   | `src/lib/excel.ts`                    |
| デプロイ手順         | `docs/DEPLOY.md`                      |
| ローカル手順         | `docs/QUICKSTART.md`                  |


