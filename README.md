# Quill — GitHub Markdown Editor

スマホ・PC どちらからでも GitHub リポジトリの Markdown を編集・コミットできる Web アプリ。
GitHub OAuth でログインし、自分のリポジトリをブラウザ上で直接編集できます。

> **データベース不要・完全ステートレス**な設計。セッション管理は AES-256-GCM 暗号化 Cookie のみで実現しています。

---

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| **フロントエンド** | React 18 / TypeScript / Vite |
| **エディタ** | @uiw/react-md-editor（リアルタイムプレビュー付き） |
| **バックエンド** | TypeScript / Hono（Cloudflare Workers） |
| **認証** | GitHub OAuth 2.0 + AES-256-GCM 暗号化セッション Cookie |
| **インフラ** | Cloudflare Workers（Static Assets + Hono を単一 Worker に統合） |
| **CI/CD** | GitHub Actions（`wrangler-action` で自動デプロイ） |

> 旧構成（AWS Lambda / API Gateway / S3 / CloudFront + Python FastAPI）から移行中。Python 版バックエンド `courier/` は切替完了まで並行稼働の参照用として残しています。

---

## アーキテクチャ

```
┌──────────────┐     ┌──────────────────────────────────────────┐
│   Browser    │────▶│         Cloudflare 単一 Worker           │
└──────────────┘     │                                          │
                     │  /api/*  ──▶  Hono（GitHub プロキシ）    │
                     │  /*      ──▶  Static Assets（React SPA） │
                     └──────────────────────────────────────────┘
                                          │
                                          ▼
                                    GitHub REST API
```

- フロントエンドとAPIを**同一オリジン**で配信（単一 Worker 内でルーティング、CORS 不要）
- Worker 上の Hono が GitHub API へのプロキシとして動作
- セッション Cookie による認証（DB 不要、完全ステートレス）

---

## 主な機能

- **GitHub OAuth ログイン** — ワンクリックで認証、シークレットモードにも対応
- **リポジトリ閲覧** — 自分のリポジトリ一覧を取得・選択
- **Markdown 編集** — ライブプレビュー付きエディタで `.md` ファイルを編集
- **Git コミット** — ブラウザから直接コミット（カスタムメッセージ対応）
- **ファイル作成・削除** — 新規 `.md` ファイルの作成、既存ファイルの削除
- **ブランチ切り替え** — リポジトリ内のブランチを選択して操作

---

## ディレクトリ構成

```
quill-md-editor/
├── quill/                        # フロントエンド
│   ├── src/
│   │   ├── App.tsx               # ルート（認証状態でページ切替）
│   │   ├── EditorPage.tsx        # メイン UI（リポジトリ/ファイル選択、エディタ、コミット）
│   │   ├── LoginPage.tsx         # ログインページ
│   │   ├── useAuth.ts            # 認証カスタムフック
│   │   ├── api.ts                # API クライアント（fetch ラッパー）
│   │   └── styles.css            # モノトーン・ミニマルデザイン
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
│
├── worker/                       # バックエンド（Cloudflare Workers / Hono）
│   ├── src/
│   │   ├── index.ts             # Worker エントリ、/api ルーティング + Static Assets 配信
│   │   ├── auth.ts              # OAuth ログイン/コールバック/ログアウト
│   │   ├── session.ts          # AES-256-GCM セッション暗号化・復号（Web Crypto）
│   │   ├── github.ts           # GitHub API クライアント（fetch）
│   │   └── types.ts            # Env バインディング型
│   ├── wrangler.toml
│   └── package.json
│
├── courier/                      # 旧バックエンド（Python FastAPI、切替まで参照用に残置）
│   ├── app/
│   │   ├── main.py               # FastAPI アプリ、REST エンドポイント、Lambda ハンドラ
│   │   ├── auth.py               # OAuth ログイン/コールバック/ログアウト
│   │   ├── session.py            # Fernet セッション暗号化・復号
│   │   └── github.py             # GitHub API クライアント
│   ├── requirements.txt
│   └── .env.example
│
├── scripts/
│   └── setup-aws.sh              # （旧）AWS インフラ一括構築スクリプト
│
├── .github/workflows/
│   ├── deploy-cloudflare.yml     # quill + worker → Cloudflare Workers 自動デプロイ
│   ├── deploy-backend.yml        # （旧）courier → Lambda 自動デプロイ
│   └── deploy-frontend.yml       # （旧）quill → S3 + CloudFront 自動デプロイ
│
└── docs/
    ├── deployment-cloudflare.md  # Cloudflare デプロイ手順書
    └── deployment.md             # （旧）AWS デプロイ手順書
```

---

## セキュリティ設計

| 項目 | 実装 |
|------|------|
| セッション管理 | AES-256-GCM 対称暗号化 Cookie（HttpOnly / SameSite=Lax / Secure） |
| CSRF 対策 | OAuth state パラメータによるトークン検証 |
| Cookie TTL | 8 時間で自動失効（暗号ペイロードに `exp` を埋め込み検証） |
| 静的配信 | Cloudflare Static Assets（オリジンサーバなし、同一オリジン配信） |
| CI/CD 認証 | Cloudflare API Token（GitHub Secrets 経由） |
| API 認証 | 全エンドポイントでセッション Cookie を検証、401 で自動リロード |

---

## API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/auth/login` | GitHub OAuth ログイン開始 |
| GET | `/auth/callback` | OAuth コールバック処理 |
| GET | `/auth/me` | ログインユーザー情報取得 |
| POST | `/auth/logout` | ログアウト |
| GET | `/repos` | リポジトリ一覧取得 |
| GET | `/files` | `.md` ファイル一覧取得 |
| GET | `/file` | ファイル内容取得 |
| POST | `/commit` | ファイル変更をコミット |
| POST | `/files/create` | 新規ファイル作成 |
| POST | `/files/delete` | ファイル削除 |

---

## ローカル開発

### 1. GitHub OAuth App を作成

[GitHub Developer Settings](https://github.com/settings/developers) → **New OAuth App**

| 項目 | 値 |
|------|-----|
| Homepage URL | `http://localhost:5173` |
| Authorization callback URL | `http://localhost:8000/auth/callback` |

### 2. バックエンド（courier）

```bash
cd courier
cp .env.example .env   # 各値を設定
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

`.env` に設定する項目：

| 変数 | 説明 |
|------|------|
| `GITHUB_CLIENT_ID` | OAuth App の Client ID |
| `GITHUB_CLIENT_SECRET` | OAuth App の Client Secret |
| `SESSION_SECRET_KEY` | Fernet 暗号化キー（下記コマンドで生成） |

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### 3. フロントエンド（quill）

```bash
cd quill
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開く。

---

## デプロイ

Cloudflare へのデプロイ手順は [`docs/deployment-cloudflare.md`](docs/deployment-cloudflare.md) を参照してください。概要:

```bash
# フロントをビルド（quill/dist を生成）
cd quill && npm ci && npm run build

# Worker をデプロイ（quill/dist を同梱）
cd ../worker && npm ci
npx wrangler secret put GITHUB_CLIENT_SECRET   # 初回のみ
npx wrangler secret put SESSION_SECRET_KEY     # 初回のみ（openssl rand -base64 32）
npx wrangler deploy
```

以降は `main` ブランチへの push で GitHub Actions（`deploy-cloudflare.yml`）が自動デプロイします。`quill/` または `worker/` の変更でトリガーされ、フロントのビルドと Worker のデプロイをまとめて実行します。

> 旧 AWS 版のデプロイ手順は [`docs/deployment.md`](docs/deployment.md) に残しています（切替完了後に削除予定）。
