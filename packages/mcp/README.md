# research-agent-mcp

このパッケージは、Claude Desktop から `research-agent` サーバーへ接続するための MCP サーバーです。

初回セットアップは、まず下記コマンドを実行します。実行するとサーバー側の要件に応じて、**API key / Client ID を入力するように対話で求められます**（対話で求められた場合は、そのまま入力してください）。

## 初回セットアップ（非対話）

```bash
npx -y --package=research-agent-mcp@latest -- research-agent-mcp-setup --url=https://<あなたのRenderのURL>
```

上のコマンドで `--url` だけ指定した場合でも、サーバーが認証を要求しているときは **セットアップ途中で API key / Client ID の入力が求められます**。

また、入力をスキップして非対話で完了させたい場合は、認証が必要なときに限り追加で以下のように指定します。

```bash
npx -y --package=research-agent-mcp@latest -- research-agent-mcp-setup --url=https://<あなたのRenderのURL> --api-key=<your-key> --client-id=<your-client-id>
```

## メモ
- `--url` を差し替えるだけで、接続先サーバーを変更できます。
- `--api-key` / `--client-id` は、サーバー側の要件が有効な場合にだけ必要です（要求されない場合は不要）。

