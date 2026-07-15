# Cloudflare デプロイ手順

Quill の Cloudflare 構成:

```
ブラウザ → quill.hinami.workers.dev → 単一 Worker
                                      ├─ /api/*  → Hono（GitHub API プロキシ）
                                      └─ /*      → Static Assets（quill/dist, SPA fallback）
                                                        ↓
                                                  GitHub REST API
```

フロントエンドと API を**同一 Worker・同一オリジン**で配信するため、CORS 設定は不要。セッションは AES-256-GCM の暗号化 Cookie（DB 不要・完全ステートレス）。

## 前提条件

- Cloudflare アカウント（Workers 有効）
- Node.js 20+
- `worker/` で `npm install` 済み

> 個人利用のため独自ドメインは取得せず、Workers が標準で払い出す `*.workers.dev` をそのまま本番ドメインとして使う。独自ドメインを使う場合の手順は「10. 独自ドメインを割り当てる場合」を参照。

---

## 1. シークレットの準備

セッション暗号鍵（AES-256 用の 32 バイト）を生成する:

```bash
openssl rand -base64 32
```

> 旧 AWS 版の Fernet 鍵とは非互換。切替時に既存セッションは失効し、ユーザーは再ログインが必要（8h TTL のため実害は小さい）。

---

## 2. `wrangler.toml` の設定

`worker/wrangler.toml` の `[vars]` はコミット済みの実値で運用する（`GITHUB_CLIENT_ID` / コールバック URL / オリジンはいずれも公開情報なのでコミット可）:

```toml
[vars]
ENV = "production"
GITHUB_CLIENT_ID = "Ov23lio3kxTl5gIdlrt3"
OAUTH_CALLBACK_URL = "https://quill.hinami.workers.dev/api/auth/callback"
FRONTEND_ORIGIN = "https://quill.hinami.workers.dev"
```

> ここをプレースホルダのままにしないこと。`deploy-cloudflare.yml` はリポジトリの `wrangler.toml` をそのまま適用するため、`[vars]` の値が本番の設定を無条件に上書きする。ダッシュボードで直接編集しても次回デプロイで巻き戻る。

---

## 3. Secrets の投入

機密値は `wrangler secret put` で投入する（`wrangler.toml` には書かない）:

```bash
cd worker
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET_KEY   # 手順 1 で生成した値
```

`GITHUB_CLIENT_SECRET` が client_id と対応していないと、ログインが `GitHub token error: The client_id and/or client_secret passed are incorrect.` で失敗する。投入した値が正しいかは GitHub に直接問い合わせて確認できる:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -u "<client_id>:<client_secret>" \
  -X POST "https://api.github.com/applications/<client_id>/token" \
  -H "Accept: application/vnd.github+json" -d '{"access_token":"dummy"}'
```

`404`（ダミートークンが無いだけ）なら資格情報は有効。`401`（Bad credentials）ならペアが誤っている。

---

## 4. GitHub OAuth App

Cloudflare 版は AWS 版とは別の OAuth App を使う（AWS 版の Callback は `/auth/callback` で、`/api` 配下の Cloudflare 版とパスが異なるため共用できない）。設定値:

| 設定 | 値 |
|---|---|
| Homepage URL | `https://quill.hinami.workers.dev` |
| Authorization callback URL | `https://quill.hinami.workers.dev/api/auth/callback` |

> Callback パスが `/api/auth/callback` である点に注意（Hono の basePath `/api` 配下）。

OAuth App は Callback URL を 1 つしか登録できない。ドメインを変えるときは、この App でログインしている全環境が同時に切り替わる。

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
| `OAUTH_CALLBACK_URL` | vars | `https://quill.hinami.workers.dev/api/auth/callback` |
| `FRONTEND_ORIGIN` | vars | ログイン後のリダイレクト先オリジン |
| `ENV` | vars | `production` で Secure Cookie 有効化 |

`OAUTH_CALLBACK_URL` / `FRONTEND_ORIGIN` / OAuth App の Callback の 3 つは常に同じドメインを指す。1 つでもずれるとログインが失敗する。

---

## 9. AWS からの切替と後片付け

1. `workers.dev` で全 API フローを確認（ログイン → 一覧 → 編集 → コミット/作成/削除）
2. 問題なければ AWS リソース（Lambda / API Gateway / S3 / CloudFront / IAM）と旧コード（`courier/` / `scripts/setup-aws.sh` / 旧 workflow / `docs/deployment.md`）を削除

Cloudflare 版は AWS 版と別ドメイン・別 OAuth App で動くため、両者は互いに干渉しない。DNS の切替作業はなく、利用する URL を変えるだけで移行が完了する。

---

## 10. 独自ドメインを割り当てる場合

現構成では不要（`*.workers.dev` で運用）。将来割り当てるなら:

1. ドメインを Cloudflare にゾーンとして追加し、ネームサーバを Cloudflare に委任する
2. `wrangler.toml` の `[[routes]]` のコメントを外す（証明書と DNS レコードは `wrangler deploy` 時に自動作成される）

   ```toml
   [[routes]]
   pattern = "app.example.com"
   custom_domain = true
   ```
3. `[vars]` の `OAUTH_CALLBACK_URL` / `FRONTEND_ORIGIN` を新ドメインに変更してデプロイ
4. OAuth App の Homepage / Callback を新ドメインに変更（この時点で `workers.dev` でのログインは動かなくなる）
