# Cloudflare デプロイ手順

Quill の Cloudflare 構成:

```
ブラウザ → 独自ドメイン（Cloudflare）→ 単一 Worker
                                        ├─ /api/*  → Hono（GitHub API プロキシ）
                                        └─ /*      → Static Assets（quill/dist, SPA fallback）
                                                          ↓
                                                    GitHub REST API
```

フロントエンドと API を**同一 Worker・同一オリジン**で配信するため、CORS 設定は不要。セッションは AES-256-GCM の暗号化 Cookie（DB 不要・完全ステートレス）。

## 前提条件

- Cloudflare アカウント（Workers 有効）
- 独自ドメインを Cloudflare に追加済み（ネームサーバを Cloudflare に委任）
- Node.js 20+
- `worker/` で `npm install` 済み

---

## 1. シークレットの準備

セッション暗号鍵（AES-256 用の 32 バイト）を生成する:

```bash
openssl rand -base64 32
```

> 旧 AWS 版の Fernet 鍵とは非互換。切替時に既存セッションは失効し、ユーザーは再ログインが必要（8h TTL のため実害は小さい）。

---

## 2. `wrangler.toml` の設定

`worker/wrangler.toml` の `[vars]` を実値に置換する（`GITHUB_CLIENT_ID` / コールバック URL / オリジンはいずれも公開情報なのでコミット可）:

```toml
[vars]
ENV = "production"
GITHUB_CLIENT_ID = "Ov23li..."
OAUTH_CALLBACK_URL = "https://app.example.com/api/auth/callback"
FRONTEND_ORIGIN = "https://app.example.com"
```

カスタムドメインを割り当てる場合は `[[routes]]` のコメントを外す:

```toml
[[routes]]
pattern = "app.example.com"
custom_domain = true
```

---

## 3. Secrets の投入

機密値は `wrangler secret put` で投入する（`wrangler.toml` には書かない）:

```bash
cd worker
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET_KEY   # 手順 1 で生成した値
```

---

## 4. GitHub OAuth App

並行稼働中は AWS 版の Callback を壊さないよう、**検証用に新しい OAuth App を作成**するのが安全:

| 設定 | 値 |
|---|---|
| Homepage URL | `https://app.example.com` |
| Authorization callback URL | `https://app.example.com/api/auth/callback` |

> Callback パスが `/api/auth/callback` である点に注意（Hono の basePath `/api` 配下）。

切替完了後、本番 OAuth App の Callback を Cloudflare の URL に統一する。

---

## 5. デプロイ

フロントをビルドしてから Worker をデプロイする（`wrangler.toml` の `[assets]` が `../quill/dist` を参照するため）:

```bash
# フロントのビルド
cd quill
npm ci
npm run build

# Worker のデプロイ（quill/dist を同梱）
cd ../worker
npm ci
npx wrangler deploy
```

---

## 6. ローカル開発

```bash
# 先にフロントをビルド（アセット配信のため）
cd quill && npm run build

# Worker をローカル起動（http://localhost:8787 でフロント + API を同一オリジン配信）
cd ../worker
cp .dev.vars.example .dev.vars   # 下記を参照して各値を設定
npx wrangler dev
```

`.dev.vars`（ローカル用の機密値、コミット禁止）の例:

```
GITHUB_CLIENT_SECRET=xxxxx
SESSION_SECRET_KEY=<openssl rand -base64 32 の値>
```

ローカルの OAuth App には Callback `http://localhost:8787/api/auth/callback` を登録し、`wrangler.toml` の `OAUTH_CALLBACK_URL` / `FRONTEND_ORIGIN` を `http://localhost:8787` に合わせる（`ENV` を `production` 以外にすると Secure Cookie が無効になり http でも動作する）。

---

## 7. CI/CD

`.github/workflows/deploy-cloudflare.yml` が `main` への push（`quill/` または `worker/` 変更時）で自動デプロイする。

**GitHub リポジトリ設定 > Secrets and variables > Actions** の Secrets:

| 名前 | 値 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers 編集権限を持つ API トークン |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare アカウント ID |

> Worker の Secrets（`GITHUB_CLIENT_SECRET` / `SESSION_SECRET_KEY`）は手順 3 で投入済みの前提。CI では再投入しない。

---

## 8. 環境変数一覧

| 変数名 | 種別 | 説明 |
|---|---|---|
| `GITHUB_CLIENT_ID` | vars | OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | secret | OAuth App Client Secret |
| `SESSION_SECRET_KEY` | secret | AES-256 鍵（base64 32 バイト、`openssl rand -base64 32`） |
| `OAUTH_CALLBACK_URL` | vars | `https://<domain>/api/auth/callback` |
| `FRONTEND_ORIGIN` | vars | ログイン後のリダイレクト先オリジン |
| `ENV` | vars | `production` で Secure Cookie 有効化 |

---

## 9. AWS からの切替と後片付け

1. 検証ドメイン or `workers.dev` で全 API フローを確認（ログイン → 一覧 → 編集 → コミット/作成/削除）
2. DNS を Cloudflare に向け、本番 OAuth App の Callback を Cloudflare の URL に更新、本番トラフィックで最終確認
3. 一定期間の並行稼働で問題なければ AWS リソース（Lambda / API Gateway / S3 / CloudFront / IAM）と旧コード（`courier/` / `scripts/setup-aws.sh` / 旧 workflow / `docs/deployment.md`）を削除
