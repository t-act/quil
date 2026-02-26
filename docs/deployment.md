# AWS デプロイ手順

Quill のデプロイ構成:

```
ブラウザ → CloudFront → S3 (フロントエンド)
              ↓
         API Gateway → Lambda (バックエンド) → GitHub API
```

## 前提条件

- AWS CLI がインストール済み・認証済み
- GitHub OAuth App が作成済み（本番用コールバックURLで）
- Node.js 18+ / Python 3.11+

---

## 1. バックエンド (Lambda)

### 1-1. デプロイパッケージ作成

```bash
cd courier
mkdir -p package
pip install -r requirements.txt -t package/
cp -r app/ package/app/
cd package && zip -r ../lambda.zip . && cd ..
```

### 1-2. Lambda 関数の作成

```bash
aws lambda create-function \
  --function-name quill-api \
  --runtime python3.11 \
  --handler app.main.handler \
  --zip-file fileb://lambda.zip \
  --role arn:aws:iam::<ACCOUNT_ID>:role/<LAMBDA_ROLE> \
  --timeout 30 \
  --memory-size 256 \
  --environment "Variables={
    GITHUB_CLIENT_ID=<YOUR_CLIENT_ID>,
    GITHUB_CLIENT_SECRET=<YOUR_CLIENT_SECRET>,
    SESSION_SECRET_KEY=<YOUR_FERNET_KEY>,
    OAUTH_CALLBACK_URL=https://<API_DOMAIN>/auth/callback,
    FRONTEND_ORIGIN=https://<FRONTEND_DOMAIN>,
    ENV=production
  }"
```

Fernet キーの生成:
```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### 1-3. Lambda 実行ロール

最小限のポリシー:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

### 1-4. API Gateway (HTTP API)

```bash
# HTTP API 作成
aws apigatewayv2 create-api \
  --name quill-api \
  --protocol-type HTTP

# Lambda 統合を作成
aws apigatewayv2 create-integration \
  --api-id <API_ID> \
  --integration-type AWS_PROXY \
  --integration-uri arn:aws:lambda:<REGION>:<ACCOUNT_ID>:function:quill-api \
  --payload-format-version 2.0

# デフォルトルート ($default) でLambdaに全リクエストを転送
aws apigatewayv2 create-route \
  --api-id <API_ID> \
  --route-key '$default' \
  --target integrations/<INTEGRATION_ID>

# ステージ作成・デプロイ
aws apigatewayv2 create-stage \
  --api-id <API_ID> \
  --stage-name '$default' \
  --auto-deploy
```

API Gateway が Lambda を呼び出せるよう権限を付与:
```bash
aws lambda add-permission \
  --function-name quill-api \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:<REGION>:<ACCOUNT_ID>:<API_ID>/*"
```

API エンドポイント: `https://<API_ID>.execute-api.<REGION>.amazonaws.com`

---

## 2. フロントエンド (S3 + CloudFront)

### 2-1. ビルド

```bash
cd quill
echo "VITE_API_BASE=https://<API_ID>.execute-api.<REGION>.amazonaws.com" > .env.production
npm install
npm run build
```

### 2-2. S3 バケット作成・アップロード

```bash
aws s3 mb s3://quill-frontend-<ACCOUNT_ID>

aws s3 sync dist/ s3://quill-frontend-<ACCOUNT_ID>/ \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "index.html"

aws s3 cp dist/index.html s3://quill-frontend-<ACCOUNT_ID>/index.html \
  --cache-control "no-cache"
```

### 2-3. CloudFront ディストリビューション

CloudFront コンソールまたは CLI で作成:

- **オリジン**: S3 バケット（OAC で接続）
- **デフォルトルートオブジェクト**: `index.html`
- **カスタムエラーレスポンス**: 403/404 → `/index.html` (ステータス 200)
  - React SPA のクライアントサイドルーティング対応に必須
- **キャッシュポリシー**: CachingOptimized (推奨)

S3 バケットポリシー (OAC 用):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::quill-frontend-<ACCOUNT_ID>/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DIST_ID>"
        }
      }
    }
  ]
}
```

---

## 3. GitHub OAuth App 設定

本番用の GitHub OAuth App を更新:

| 設定 | 値 |
|---|---|
| Homepage URL | `https://<FRONTEND_DOMAIN>` |
| Authorization callback URL | `https://<API_DOMAIN>/auth/callback` |

---

## 4. CI/CD (GitHub Actions)

`main` ブランチへの push で自動デプロイされる。`courier/` と `quill/` の変更パスで独立して実行。

### 4-1. AWS OIDC プロバイダーの設定

GitHub Actions から IAM ロールを引き受けるため、OIDC プロバイダーを作成する（アカウントに一度だけ）:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

### 4-2. GitHub Actions 用 IAM ロール

信頼ポリシー:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:<GITHUB_OWNER>/<GITHUB_REPO>:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

権限ポリシー:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Lambda",
      "Effect": "Allow",
      "Action": ["lambda:UpdateFunctionCode"],
      "Resource": "arn:aws:lambda:<REGION>:<ACCOUNT_ID>:function:quill-api"
    },
    {
      "Sid": "S3",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::quill-frontend-<ACCOUNT_ID>",
        "arn:aws:s3:::quill-frontend-<ACCOUNT_ID>/*"
      ]
    },
    {
      "Sid": "CloudFront",
      "Effect": "Allow",
      "Action": ["cloudfront:CreateInvalidation"],
      "Resource": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DIST_ID>"
    }
  ]
}
```

### 4-3. GitHub リポジトリの設定

**Settings > Secrets and variables > Actions** で以下を設定する。

Secrets:
| 名前 | 値 |
|---|---|
| `AWS_ROLE_ARN` | 4-2 で作成した IAM ロールの ARN |

Variables:
| 名前 | 値 |
|---|---|
| `AWS_REGION` | `ap-northeast-1` など |
| `LAMBDA_FUNCTION_NAME` | `quill-api` |
| `S3_BUCKET_NAME` | `quill-frontend-<ACCOUNT_ID>` |
| `CLOUDFRONT_DISTRIBUTION_ID` | CloudFront のディストリビューション ID |
| `VITE_API_BASE` | `https://<API_ID>.execute-api.<REGION>.amazonaws.com` |

### 4-4. ワークフローファイル

リポジトリに配置済み:

- `.github/workflows/deploy-backend.yml` — `courier/` 変更時に Lambda を更新
- `.github/workflows/deploy-frontend.yml` — `quill/` 変更時に S3 同期 + CloudFront 無効化

### 4-5. デプロイの流れ

```
main へ push / PR マージ
    ├── courier/ に変更あり → deploy-backend → Lambda 更新
    └── quill/ に変更あり  → deploy-frontend → S3 同期 → CloudFront 無効化
```

両方に変更がある場合は 2 つのワークフローが並行実行される。

---

## 5. 手動デプロイ

CI/CD を使わず手動でデプロイする場合。

### バックエンド更新

```bash
cd courier
rm -rf package lambda.zip
mkdir -p package
pip install -r requirements.txt -t package/
cp -r app/ package/app/
cd package && zip -r ../lambda.zip . && cd ..

aws lambda update-function-code \
  --function-name quill-api \
  --zip-file fileb://lambda.zip
```

### フロントエンド更新

```bash
cd quill
npm run build

aws s3 sync dist/ s3://quill-frontend-<ACCOUNT_ID>/ \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "index.html"

aws s3 cp dist/index.html s3://quill-frontend-<ACCOUNT_ID>/index.html \
  --cache-control "no-cache"

aws cloudfront create-invalidation \
  --distribution-id <DIST_ID> \
  --paths "/"
```

---

## 環境変数一覧

| 変数名 | 説明 | 例 |
|---|---|---|
| `GITHUB_CLIENT_ID` | OAuth App Client ID | `Ov23li...` |
| `GITHUB_CLIENT_SECRET` | OAuth App Client Secret | `xxxxx...` |
| `SESSION_SECRET_KEY` | Fernet 暗号化キー | `sFmJH...=` |
| `OAUTH_CALLBACK_URL` | OAuth コールバック URL | `https://api.example.com/auth/callback` |
| `FRONTEND_ORIGIN` | フロントエンドのオリジン | `https://app.example.com` |
| `ENV` | `production` でSecure cookie 有効化 | `production` |
| `VITE_API_BASE` | (フロントエンド) API ベース URL | `https://api.example.com` |
