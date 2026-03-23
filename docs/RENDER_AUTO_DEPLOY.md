# Render で GitHub から自動デプロイする

`main` に push したらビルド・デプロイが走るようにする手順です。

---

## パターン A: すでに Web Service がある（いちばん多い）

コード変更は**不要**です。Render ダッシュボードの設定です。

### 1. GitHub と Render の接続

1. [Render Dashboard](https://dashboard.render.com) → 対象の **Web Service** を開く  
2. **Settings** → **Build & Deploy**
3. **Repository** が正しいリポジトリ（例: `yuki2737/research-agent`）になっているか確認  
   - 違う / 空なら **Connect account** または **Link repository** で GitHub を再接続  
4. GitHub 側で **Render にリポジトリへのアクセスを許可**しているか確認  
   - GitHub → **Settings** → **Applications** → **Authorized OAuth Apps** / **Installed GitHub Apps** → Render  
   - 対象リポジトリが **All repositories** か、**Only select** ならこのリポジトリにチェックが入っているか

### 2. ブランチと自動デプロイ

1. 同じ **Build & Deploy** セクションで  
   - **Branch**: `main`（使っているブランチに合わせる）  
2. **Auto-Deploy** を **`Yes`** にする  
   - `On commit` / `Automatic` など表示はプランにより表記が変わりますが、「push でデプロイ」が有効な状態にする  

### 3. 動作確認

1. 空コミットでもよいので `git push origin main`  
2. Render の **Events** / **Logs** に新しい **Deploy** が出るか確認  
3. 出ない場合は **Manual Deploy** → **Deploy latest commit** が通るか確認（通ればビルド設定は問題なしで、自動のトリガーだけの不具合）

### よくある原因

| 症状 | 確認すること |
|------|----------------|
| push しても何も起きない | **Auto-Deploy が Off**、**別ブランチ**を見ている |
| リポジトリが更新されない | GitHub の **fork 先**と Render が指す **リモート**が一致しているか |
| 組織リポジトリ | GitHub で Render に **Organization のリポジトリ権限**を付与したか |

---

## パターン B: これから Render に新規作成する

1. **New** → **Web Service**（または **Blueprint**）  
2. **Connect a repository** で GitHub の `research-agent` を選択  
3. ビルド設定（このリポジトリの例）  
   - **Build Command**: `npm install && npm run build`  
   - **Start Command**: `node dist/server.js`  
4. **Advanced** で **Root Directory** は空（モノレポでサーバーがサブディレクトリならそこを指定）  
5. 環境変数を設定したうえで **Create Web Service**  
6. 作成後、**Settings** → **Build & Deploy** で **Auto-Deploy: Yes** と **Branch: main** を確認  

ルートに **`render.yaml`** がある場合、**New → Blueprint** で同じリポジトリを選ぶと、ファイル内容に沿ってサービスを作成・更新できます（既存の手動 Web Service とは別管理になるので、**既存サービスがある場合はパターン A** の方が安全です）。

---

## GitHub 側で触ることがある設定

- **Branch protection**（`main` に直接 push 禁止 + PR のみ）の場合、**マージされたらデプロイ**されるので、Render のブランチは **`main`** のままで問題ありません。  
- **GitHub Actions** で別デプロイはしていないか（二重デプロイの有無）だけ把握しておくとよいです。

---

## このリポジトリのビルド・起動（参考）

| 項目 | 値 |
|------|-----|
| Build | `npm install && npm run build` |
| Start | `node dist/server.js` |
| ヘルスチェック | `GET /health` |

環境変数の一覧は [DEPLOY.md](./DEPLOY.md) を参照してください。
