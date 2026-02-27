# 使える状態にする手順

以下を**順番に**やると、Claude Desktop から事例調査が使えます。

---

## 1. API キーを用意する

- [Anthropic](https://console.anthropic.com/) で **ANTHROPIC_API_KEY** を発行
- [SerpAPI](https://serpapi.com/) で **SERPAPI_API_KEY** を発行

---

## 2. プロジェクトの準備

```bash
cd /Users/itoyuki/code/research-agent
npm install
cp .env.example .env
```

`.env` を開き、次の2つを入れる：

```
ANTHROPIC_API_KEY=sk-ant-...
SERPAPI_API_KEY=...
```

`APP_URL` は開発ならそのままでよい（`http://localhost:3000`）。

---

## 3. アプリと Inngest を起動する（2つターミナル）

**ターミナル A**

```bash
cd /Users/itoyuki/code/research-agent
npm run dev
```

`Server listening on http://localhost:3000` と出れば OK。

**ターミナル B**（別ターミナル）

```bash
cd /Users/itoyuki/code/research-agent
npm run inngest:dev
```

Inngest の Dev UI が立ち上がれば OK（ブラウザが開く場合あり）。  
**この2つは起動したままにしておく。**

---

## 4. Claude Desktop に MCP を追加する

1. Claude Desktop の **設定** → **Developer** → **Edit config** を開く。
2. `claude_desktop_config.json` に次を追加（`mcpServers` が既にあれば、その中に `research-agent` を足す）。

```json
{
  "mcpServers": {
    "research-agent": {
      "command": "npx",
      "args": [
        "tsx",
        "/Users/itoyuki/code/research-agent/src/mcp-server.ts"
      ],
      "env": {
        "DATA_DIR": "/Users/itoyuki/code/research-agent/data",
        "OUTPUT_DIR": "/Users/itoyuki/code/research-agent/output"
      }
    }
  }
}
```

3. **Claude Desktop を再起動**する（MCP を読み込ませるため）。

プロジェクトを別の場所に置いている場合は、  
`/Users/itoyuki/code/research-agent` をそのパスに書き換えてください。

---

## 5. 使い方

1. Claude Desktop で**新しいチャット**を開く。
2. 例えば「製造業のDX事例を調査して」と入力。
3. Claude が `search_cases` を実行し、「調査を開始しました」と返す。
4. 1〜2分ほど待ってから「結果を教えて」と入力。
5. Claude が `get_case_study_result` を実行し、サマリーと Excel の保存場所を教えてくれる。

Excel はプロジェクトの `output/` フォルダに `cases-<runId>.xlsx` で保存されます。

---

## うまく動かないとき

- **「調査を開始しました」のあと結果が出ない**  
  → ターミナル A・B の両方が起動しているか確認。Inngest のログにエラーが出ていないか見る。

- **MCP のツールが使えない**  
  → Claude Desktop を再起動。`claude_desktop_config.json` のパスが実際のプロジェクト場所と一致しているか確認。

- **API エラー**  
  → `.env` の `ANTHROPIC_API_KEY` と `SERPAPI_API_KEY` が正しく設定されているか確認。
