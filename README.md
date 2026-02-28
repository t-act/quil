# Quill — GitHub Markdown Editor

スマホ・PC どちらからでも GitHub リポジトリの Markdown を編集・コミットできる Web アプリ。
GitHub OAuth でログインし、自分のリポジトリをブラウザ上で直接編集できます。

> **データベース不要・完全ステートレス**な設計。セッション管理は Fernet 暗号化 Cookie のみで実現しています。

---

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| **フロントエンド** | React 18 / TypeScript / Vite |
| **エディタ** | @uiw/react-md-editor（リアルタイムプレビュー付き） |
| **バックエンド** | Python FastAPI / Uvicorn |
| **認証** | GitHub OAuth 2.0 + Fernet 暗号化セッション Cookie |
| **インフラ** | AWS Lambda / API Gateway / S3 / CloudFront |
| **CI/CD** | GitHub Actions（OIDC 認証、パス別自動デプロイ） |

---

## アーキテクチャ

```
┌──────────────┐     ┌──────────────────────────────────────────┐
│   Browser    │────▶│            CloudFront CDN                │
└──────────────┘     │                                          │
                     │  /api/*  ──▶  API Gateway ──▶  Lambda   │
                     │  /*      ──▶  S3 (React SPA)            │
                     └──────────────────────────────────────────┘
                                          │
                                          ▼
                                    GitHub REST API
```

- フロントエンドとAPIを**同一ドメイン**で配信（CloudFront のパスベースルーティング）
- Lambda 上の FastAPI が GitHub API へのプロキシとして動作
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
├── courier/                      # バックエンド
│   ├── app/
│   │   ├── main.py               # FastAPI アプリ、REST エンドポイント、Lambda ハンドラ
│   │   ├── auth.py               # OAuth ログイン/コールバック/ログアウト
│   │   ├── session.py            # Fernet セッション暗号化・復号
│   │   └── github.py             # GitHub API クライアント
│   ├── requirements.txt
│   └── .env.example
│
├── scripts/
│   └── setup-aws.sh              # AWS インフラ一括構築スクリプト
│
├── .github/workflows/
│   ├── deploy-backend.yml        # courier → Lambda 自動デプロイ
│   └── deploy-frontend.yml       # quill → S3 + CloudFront 自動デプロイ
│
└── docs/
    └── deployment.md             # デプロイ手順書
```

---

## セキュリティ設計

| 項目 | 実装 |
|------|------|
| セッション管理 | Fernet 対称暗号化 Cookie（HttpOnly / SameSite=Lax / Secure） |
| CSRF 対策 | OAuth state パラメータによるトークン検証 |
| Cookie TTL | 8 時間で自動失効 |
| S3 アクセス | Origin Access Control（OAC）で直接アクセスをブロック |
| CI/CD 認証 | GitHub Actions OIDC（長期クレデンシャル不要） |
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

AWS へのデプロイは `scripts/setup-aws.sh` で Lambda / API Gateway / S3 / CloudFront / IAM を一括構築できます。

```bash
# 必要な環境変数を設定してから実行
export GITHUB_CLIENT_ID="..."
export GITHUB_CLIENT_SECRET="..."
bash scripts/setup-aws.sh
```

以降は `main` ブランチへの push で GitHub Actions が自動デプロイします。

- `courier/` の変更 → Lambda を更新
- `quill/` の変更 → S3 にアップロード + CloudFront キャッシュ無効化
