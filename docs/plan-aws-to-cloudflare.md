# AWS → Cloudflare 移行計画（Quill）

## Context

Quill は「React/Vite SPA（`quill/`）＋ FastAPI バックエンド（`courier/`）」で、現在は **S3+CloudFront / Lambda+API Gateway** に載っている。これを Cloudflare へ移行する。目的はインフラの簡素化（同一オリジン化・単一デプロイ）とコスト/運用の軽量化。

バックエンドは GitHub API プロキシで、外部通信に `requests`、セッションに `cryptography.Fernet`（暗号化 Cookie）を使う。両者とも Cloudflare Workers ランタイムでは動かないため、**Hono/TypeScript で書き直す**方針を採用（ユーザー確定事項）。データベースはなく完全ステートレスなので、移行の状態管理リスクは無い。

**確定した方針**
- backend: **Hono/TypeScript で Cloudflare Workers に書き直し**（`requests`→`fetch`、`Fernet`→Web Crypto AES-GCM）
- ドメイン: **独自ドメインは取得せず `quill.hinami.workers.dev` を本番ドメインとする**（完全な個人利用のため、独自ドメインのコストに見合う価値がないと判断。当初は独自ドメイン委任を予定していたが撤回）
- 移行方針: **AWS を並行稼働**させたまま Cloudflare 側を構築・検証し、動作確認後に切替（ロールバック容易）

## 移行マッピング

| 現行 (AWS) | 移行先 (Cloudflare) |
|---|---|
| CloudFront + S3（SPA配信・OAC） | **Cloudflare Workers Static Assets**（同一 Worker で配信） |
| API Gateway + Lambda（FastAPI/Mangum） | **Cloudflare Workers（Hono）** |
| CloudFront パスベースルーティング（`/api/*`→APIGW, `/*`→S3） | **単一 Worker 内ルーティング**（`/api/*`→Hono, それ以外→静的アセット + SPA fallback） |
| Fernet 暗号 Cookie | **AES-256-GCM 暗号 Cookie（Web Crypto）** |
| IAM ロール / GitHub OIDC | **Cloudflare API Token** |
| GitHub Actions（AWS CLI デプロイ） | **GitHub Actions（`cloudflare/wrangler-action`）** |
| `scripts/setup-aws.sh` | **`wrangler.toml`（IaC 相当）** |

## 最終アーキテクチャ（推奨: 単一 Worker 統合）

```
ブラウザ → quill.hinami.workers.dev → 単一 Worker
                                      ├─ /api/*  → Hono（GitHub API プロキシ）
                                      └─ /*      → Static Assets（quill/dist, SPA fallback）
                                                        ↓
                                                  GitHub REST API
```

フロントと API が**完全に同一オリジン**になるため CORS 設定が不要になり、Cookie（`SameSite=Lax`）もそのまま機能する。デプロイも 1 本に統合される。
（代替案: フロントを Cloudflare Pages、API を別 Worker にし Routes で同一ドメインに束ねる構成も可能。単一 Worker の方がシンプルなため本計画では統合を採用。）

## 作業内容

### 1. backend を Hono/TS で書き直し（新規 `worker/`）

`courier/app/*.py` を TypeScript に移植。既存 Python 版は並行稼働中の参照用に残し、切替完了後に削除する。

```
worker/
  src/
    index.ts     # Worker エントリ。Hono app。/api/* ルーティング + Static Assets バインド
    auth.ts      # /api/auth/{login,callback,me,logout}（auth.py 相当）
    github.ts    # GitHub API クライアント（github.py 相当、requests→fetch）
    session.ts   # AES-GCM 暗号 Cookie（session.py 相当、Fernet→Web Crypto）
  wrangler.toml
  package.json
  tsconfig.json
```

移植の対応関係（既存ロジックをそのまま踏襲）:
- `github.py` の各関数（`list_user_repos` / `list_markdown_files` / `get_file_content` / `commit_file` / `create_file` / `delete_file`）→ `fetch` で同一エンドポイント・同一ヘッダ（`Authorization: Bearer`, `X-GitHub-Api-Version: 2022-11-28`）を叩く。base64 は Web 標準 API で処理。
- `auth.py` の OAuth フロー（state Cookie 検証 → code→token → user 取得 → セッション発行）→ Hono の `getCookie`/`setCookie` で再現。Cookie 属性は `HttpOnly` / `SameSite=Lax` / `Secure`（本番）を維持。
- `main.py` のエンドポイント（`/repos` `/files` `/file` `/commit` `/files/create` `/files/delete`）と Pydantic バリデーション → Hono ルート + zod（または最小の手動検証）。`get_session` 依存注入 → Hono ミドルウェア。
- `Mangum` ハンドラは不要（削除）。

### 2. セッション暗号（`session.ts`）

Fernet と互換にする必要はない（セッションは 8h で失効・再ログインで解決するため、切替時の既存セッションは破棄されてよい）。

- `SESSION_SECRET_KEY`: 32 バイト鍵（base64）を Worker Secret として設定
- 暗号化: `crypto.subtle` の **AES-256-GCM**。ペイロード `{ github_access_token, github_login, github_avatar_url, exp }` を JSON 化 → `iv(12B) + ciphertext` を base64url エンコードして Cookie 値に
- 復号: 復号後に `exp`（発行から 8h）を検証。失敗時は 401（既存挙動と同じ、フロントは 401 で自動リロード）
- Cookie 名 `md_editor_session` / TTL 8h / state Cookie `oauth_state` も同様に踏襲

### 3. frontend（`quill/`）の調整

- コードはほぼ変更不要。`api.ts` の `API_BASE = VITE_API_BASE ?? '/api'` は同一オリジン配信なら `/api` のままでよい（`.env.production` は不要 or 空に）
- ビルド成果物 `quill/dist` を Worker の Static Assets として配信（`wrangler.toml` の `[assets]` で `directory` 指定、SPA なので `not_found_handling = "single-page-application"` を設定 → CloudFront の 403/404→index.html 設定を代替）

### 4. `wrangler.toml`

- `main = "src/index.ts"`、`compatibility_date`、`[assets]`（`directory = "../quill/dist"`, `binding`, SPA fallback）
- `[vars]`: `ENV=production`, `GITHUB_CLIENT_ID`, `OAUTH_CALLBACK_URL`, `FRONTEND_ORIGIN`（実値をコミットする。CI がこの値で本番を上書きするため、プレースホルダを残すと本番が壊れる）
- Secrets（`wrangler secret put` で投入、平文コミットしない）: `GITHUB_CLIENT_SECRET`, `SESSION_SECRET_KEY`
- `[[routes]]` はコメントアウトのまま（`workers.dev` を使うため不要）

### 5. DNS / ドメイン

独自ドメインを取得しない方針としたため、**この工程は不要**。Workers が払い出す `quill.hinami.workers.dev` をそのまま本番ドメインとして使う。ゾーン追加・ネームサーバ委任・カスタムドメイン割当・DNS 切替はいずれも発生しない。

### 6. GitHub OAuth App

- GitHub OAuth App は callback URL を 1 つしか持てないため、**Cloudflare 用に別の OAuth App を作成**（AWS 版の callback パスは `/auth/callback` で Cloudflare 版の `/api/auth/callback` と異なり、共用できない）
- Homepage: `https://quill.hinami.workers.dev`、Callback: `https://quill.hinami.workers.dev/api/auth/callback`（Hono の basePath `/api` に合わせる）
- AWS 版とは別ドメイン・別 App で動くため両者は干渉しない。callback の統一作業は発生しない

### 7. CI/CD

- 新規 `.github/workflows/deploy-cloudflare.yml`: `quill/` または `worker/` 変更時に、`quill` をビルド → `cloudflare/wrangler-action@v3` で `wrangler deploy`
- GitHub Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- 旧 `deploy-backend.yml` / `deploy-frontend.yml` は、切替完了までは残置（AWS 並行稼働）。切替後に削除

### 8. ドキュメント

- `docs/deployment.md` を Cloudflare 版に更新、`README.md` の技術スタック/アーキテクチャ図を修正
- `docs/aws-cost-estimate.md` は Cloudflare 版コスト見積りに置換 or 追記
- 切替完了後: `courier/`, `scripts/setup-aws.sh`, 旧 workflow, AWS 用 docs を削除。AWS リソース（Lambda / API Gateway / S3 / CloudFront / IAM）を削除

## 環境変数マッピング

| 現行 (Lambda/Vite) | Cloudflare | 種別 |
|---|---|---|
| `GITHUB_CLIENT_ID` | `[vars]` | 変数 |
| `GITHUB_CLIENT_SECRET` | Worker Secret | 機密 |
| `SESSION_SECRET_KEY`（Fernet鍵）| Worker Secret（AES 32B鍵, base64）| 機密・**新規生成** |
| `OAUTH_CALLBACK_URL` | `[vars]`（`https://quill.hinami.workers.dev/api/auth/callback`）| 変数 |
| `FRONTEND_ORIGIN` | `[vars]`（同一オリジンなら実質未使用、CORS撤廃）| 変数 |
| `ENV=production` | `[vars]` | 変数 |
| `VITE_API_BASE` | 不要（`/api` 相対）| — |

## 検証（動作確認）

1. **ローカル**: `wrangler dev` で Worker を起動。`quill` をビルドしアセット配信を確認。ブラウザで以下を通す:
   - `/api/auth/login` → GitHub 認可 → `/api/auth/callback` → セッション Cookie 発行 → SPA にリダイレクト
   - `/api/auth/me`（認証状態）、`/api/repos`、`/api/files`、`/api/file`
   - 編集して `/api/commit`、`/api/files/create`、`/api/files/delete`（実リポジトリで往復確認）
   - Cookie 属性（HttpOnly / SameSite=Lax / Secure）と 8h TTL 後の 401 挙動
2. **本番（`workers.dev`）**: `wrangler deploy` 後、`quill.hinami.workers.dev` で上記フローを通しテスト
3. **後片付け**: AWS 側を使わなくなったら、AWS リソースと旧コード/workflow/docs を削除

## 段階移行の順序（まとめ）

1. ~~`worker/`（Hono 実装）を作成しローカル検証~~（完了）
2. ~~OAuth App 作成 + Secrets 投入 → `workers.dev` へデプロイ~~（完了）
3. ~~`deploy-cloudflare.yml` を追加（AWS workflow は残置）~~（完了。`main` マージで稼働開始）
4. ~~DNS 切替~~（ドメイン取得を取りやめたため不要）
5. AWS リソース・旧コード・旧 workflow・旧 docs を削除、README/deployment.md を更新 ← **残作業はここだけ**
