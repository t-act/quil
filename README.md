# quill — Markdown Editor → GitHub Commit

スマホ・PCどちらからでも、GitHubリポジトリのMarkdownを編集してコミットできるWebアプリ。
GitHub OAuthでログインし、自分のリポジトリを選択して使う。

## 構成

```
quill/    フロントエンド（React + Vite + TypeScript）
courier/  バックエンド（FastAPI）
```

---

## セットアップ

### 1. GitHub OAuth App を作成

[GitHub Developer Settings](https://github.com/settings/developers) → New OAuth App

| 項目 | 値 |
|------|-----|
| Homepage URL | `http://localhost:5173` |
| Authorization callback URL | `http://localhost:8000/auth/callback` |

### 2. courier（バックエンド）

```bash
cd courier
cp .env.example .env   # 値を埋める
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

`.env` に設定する項目：

| 変数 | 説明 |
|------|------|
| `GITHUB_CLIENT_ID` | OAuth App の Client ID |
| `GITHUB_CLIENT_SECRET` | OAuth App の Client Secret |
| `OAUTH_CALLBACK_URL` | `http://localhost:8000/auth/callback` |
| `FRONTEND_ORIGIN` | `http://localhost:5173` |
| `SESSION_SECRET_KEY` | 下記コマンドで生成 |

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### 3. quill（フロントエンド）

```bash
cd quill
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開く。

---

## API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/auth/login` | GitHub OAuth ログイン |
| GET | `/auth/callback` | OAuth コールバック |
| GET | `/auth/me` | ログイン中ユーザー情報 |
| POST | `/auth/logout` | ログアウト |
| GET | `/repos` | リポジトリ一覧 |
| GET | `/files` | .md ファイル一覧 |
| GET | `/file` | ファイル内容取得 |
| POST | `/commit` | ファイルをコミット |
| POST | `/files/create` | ファイルを新規作成 |
| POST | `/files/delete` | ファイルを削除 |
