#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_FILE="$SCRIPT_DIR/.deploy-output"

# ============================================================
# ユーティリティ
# ============================================================

info()  { printf '\033[1;34m[INFO]\033[0m  %s\n' "$*"; }
ok()    { printf '\033[1;32m[OK]\033[0m    %s\n' "$*"; }
warn()  { printf '\033[1;33m[WARN]\033[0m  %s\n' "$*"; }
error() { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

ask() {
  local prompt="$1" default="${2:-}"
  if [[ -n "$default" ]]; then
    read -rp "$prompt [$default]: " value
    echo "${value:-$default}"
  else
    local value=""
    while [[ -z "$value" ]]; do
      read -rp "$prompt: " value
    done
    echo "$value"
  fi
}

# ============================================================
# 前提条件チェック
# ============================================================

for cmd in aws python3 node npm jq; do
  command -v "$cmd" &>/dev/null || error "$cmd が見つかりません。インストールしてください。"
done

info "AWS 認証を確認しています..."
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text) \
  || error "AWS CLI の認証に失敗しました。aws configure を実行してください。"
ok "AWS アカウント: $AWS_ACCOUNT_ID"

# ============================================================
# パラメータ入力
# ============================================================

echo ""
echo "========================================="
echo "  Quill AWS セットアップ"
echo "========================================="
echo ""

AWS_REGION=$(ask "AWS リージョン" "ap-northeast-1")
GITHUB_CLIENT_ID=$(ask "GitHub OAuth Client ID")
GITHUB_CLIENT_SECRET=$(ask "GitHub OAuth Client Secret")
GITHUB_REPO_FULL=$(ask "GitHub リポジトリ (owner/repo)")

# リソース名
FUNCTION_NAME="quill-api"
ROLE_NAME="quill-lambda-role"
API_NAME="quill-api"
BUCKET_NAME="quill-frontend-${AWS_ACCOUNT_ID}"
DEPLOY_ROLE_NAME="quill-github-actions-role"

# ============================================================
# 1. Fernet 鍵の生成
# ============================================================

info "Fernet セッション鍵を生成しています..."
# courier の venv があればそちらを使う
PYTHON=python3
if [[ -f "$PROJECT_DIR/courier/.venv/bin/python3" ]]; then
  PYTHON="$PROJECT_DIR/courier/.venv/bin/python3"
fi
FERNET_KEY=$($PYTHON -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
ok "Fernet 鍵を生成しました"

# ============================================================
# 2. Lambda 実行ロールの作成
# ============================================================

info "Lambda 実行ロールを作成しています..."

ASSUME_ROLE_POLICY=$(cat <<'POLICY'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
POLICY
)

LAMBDA_ROLE_ARN=$(aws iam create-role \
  --role-name "$ROLE_NAME" \
  --assume-role-policy-document "$ASSUME_ROLE_POLICY" \
  --query 'Role.Arn' --output text)

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name quill-lambda-logs \
  --policy-document '{
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
  }'

ok "Lambda ロール: $LAMBDA_ROLE_ARN"

# IAM ロールの伝播を待機
info "IAM ロールの伝播を待っています (10秒)..."
sleep 10

# ============================================================
# 3. デプロイパッケージのビルド → Lambda 関数作成
# ============================================================

info "Lambda デプロイパッケージをビルドしています..."

cd "$PROJECT_DIR/courier"
rm -rf package lambda.zip
mkdir -p package
pip install -r requirements.txt -t package/ --quiet
cp -r app/ package/app/
cd package && zip -r ../lambda.zip . -q && cd ..
rm -rf package

ok "lambda.zip を作成しました"

info "Lambda 関数を作成しています..."

# 初回作成時はダミーの環境変数（URL未確定のため後で更新）
LAMBDA_ARN=$(aws lambda create-function \
  --function-name "$FUNCTION_NAME" \
  --runtime python3.11 \
  --handler app.main.handler \
  --zip-file fileb://lambda.zip \
  --role "$LAMBDA_ROLE_ARN" \
  --timeout 30 \
  --memory-size 256 \
  --region "$AWS_REGION" \
  --environment "Variables={
    GITHUB_CLIENT_ID=$GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET=$GITHUB_CLIENT_SECRET,
    SESSION_SECRET_KEY=$FERNET_KEY,
    ENV=production
  }" \
  --query 'FunctionArn' --output text)

ok "Lambda 関数: $LAMBDA_ARN"

# Lambda が Active になるまで待機
info "Lambda 関数の準備完了を待っています..."
aws lambda wait function-active-v2 --function-name "$FUNCTION_NAME" --region "$AWS_REGION"

# ============================================================
# 4. API Gateway HTTP API の作成
# ============================================================

info "API Gateway HTTP API を作成しています..."

API_ID=$(aws apigatewayv2 create-api \
  --name "$API_NAME" \
  --protocol-type HTTP \
  --region "$AWS_REGION" \
  --query 'ApiId' --output text)

INTEGRATION_ID=$(aws apigatewayv2 create-integration \
  --api-id "$API_ID" \
  --integration-type AWS_PROXY \
  --integration-uri "$LAMBDA_ARN" \
  --payload-format-version 2.0 \
  --region "$AWS_REGION" \
  --query 'IntegrationId' --output text)

aws apigatewayv2 create-route \
  --api-id "$API_ID" \
  --route-key '$default' \
  --target "integrations/$INTEGRATION_ID" \
  --region "$AWS_REGION" \
  --output text > /dev/null

aws apigatewayv2 create-stage \
  --api-id "$API_ID" \
  --stage-name '$default' \
  --auto-deploy \
  --region "$AWS_REGION" \
  --output text > /dev/null

API_URL="https://${API_ID}.execute-api.${AWS_REGION}.amazonaws.com"
ok "API Gateway: $API_URL"

# ============================================================
# 5. Lambda invoke 権限の付与
# ============================================================

info "API Gateway → Lambda の invoke 権限を付与しています..."

aws lambda add-permission \
  --function-name "$FUNCTION_NAME" \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:${AWS_REGION}:${AWS_ACCOUNT_ID}:${API_ID}/*" \
  --region "$AWS_REGION" \
  --output text > /dev/null

ok "invoke 権限を付与しました"

# ============================================================
# 6. S3 バケットの作成
# ============================================================

info "S3 バケットを作成しています..."

if [[ "$AWS_REGION" == "us-east-1" ]]; then
  aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$AWS_REGION"
else
  aws s3api create-bucket \
    --bucket "$BUCKET_NAME" \
    --region "$AWS_REGION" \
    --create-bucket-configuration LocationConstraint="$AWS_REGION"
fi

aws s3api put-public-access-block \
  --bucket "$BUCKET_NAME" \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

ok "S3 バケット: $BUCKET_NAME"

# ============================================================
# 7. CloudFront OAC + ディストリビューションの作成
# ============================================================

info "CloudFront OAC を作成しています..."

OAC_ID=$(aws cloudfront create-origin-access-control \
  --origin-access-control-config "{
    \"Name\": \"quill-oac\",
    \"SigningProtocol\": \"sigv4\",
    \"SigningBehavior\": \"always\",
    \"OriginAccessControlOriginType\": \"s3\",
    \"Description\": \"OAC for Quill frontend\"
  }" \
  --query 'OriginAccessControl.Id' --output text)

ok "OAC: $OAC_ID"

info "CloudFront ディストリビューションを作成しています..."

DIST_CONFIG=$(cat <<DIST
{
  "CallerReference": "quill-$(date +%s)",
  "Comment": "Quill frontend",
  "Enabled": true,
  "DefaultRootObject": "index.html",
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "s3-quill",
        "DomainName": "${BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com",
        "OriginAccessControlId": "${OAC_ID}",
        "S3OriginConfig": {
          "OriginAccessIdentity": ""
        }
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-quill",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": ["GET", "HEAD"],
    "CachedMethods": ["GET", "HEAD"],
    "Compress": true,
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "ForwardedValues": null
  },
  "CustomErrorResponses": {
    "Quantity": 2,
    "Items": [
      {
        "ErrorCode": 403,
        "ResponsePagePath": "/index.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 10
      },
      {
        "ErrorCode": 404,
        "ResponsePagePath": "/index.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 10
      }
    ]
  },
  "PriceClass": "PriceClass_200"
}
DIST
)

DIST_RESULT=$(aws cloudfront create-distribution \
  --distribution-config "$DIST_CONFIG" \
  --output json)

DIST_ID=$(echo "$DIST_RESULT" | jq -r '.Distribution.Id')
DIST_DOMAIN=$(echo "$DIST_RESULT" | jq -r '.Distribution.DomainName')
FRONTEND_URL="https://${DIST_DOMAIN}"

ok "CloudFront ディストリビューション: $DIST_ID"
ok "フロントエンド URL: $FRONTEND_URL"

# ============================================================
# 8. S3 バケットポリシーの設定
# ============================================================

info "S3 バケットポリシーを設定しています..."

aws s3api put-bucket-policy \
  --bucket "$BUCKET_NAME" \
  --policy "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {
        \"Effect\": \"Allow\",
        \"Principal\": {
          \"Service\": \"cloudfront.amazonaws.com\"
        },
        \"Action\": \"s3:GetObject\",
        \"Resource\": \"arn:aws:s3:::${BUCKET_NAME}/*\",
        \"Condition\": {
          \"StringEquals\": {
            \"AWS:SourceArn\": \"arn:aws:cloudfront::${AWS_ACCOUNT_ID}:distribution/${DIST_ID}\"
          }
        }
      }
    ]
  }"

ok "バケットポリシーを設定しました"

# ============================================================
# 9. Lambda 環境変数の更新（URL確定後）
# ============================================================

info "Lambda 環境変数を更新しています..."

aws lambda update-function-configuration \
  --function-name "$FUNCTION_NAME" \
  --region "$AWS_REGION" \
  --environment "Variables={
    GITHUB_CLIENT_ID=$GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET=$GITHUB_CLIENT_SECRET,
    SESSION_SECRET_KEY=$FERNET_KEY,
    OAUTH_CALLBACK_URL=${API_URL}/auth/callback,
    FRONTEND_ORIGIN=$FRONTEND_URL,
    ENV=production
  }" \
  --output text > /dev/null

ok "Lambda 環境変数を更新しました"

# ============================================================
# 10. フロントエンドのビルド & S3 デプロイ
# ============================================================

info "フロントエンドをビルドしています..."

cd "$PROJECT_DIR/quill"
echo "VITE_API_BASE=$API_URL" > .env.production
npm install --silent
npm run build

info "S3 にデプロイしています..."

aws s3 sync dist/ "s3://${BUCKET_NAME}/" \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "index.html"

aws s3 cp dist/index.html "s3://${BUCKET_NAME}/index.html" \
  --cache-control "no-cache"

ok "フロントエンドをデプロイしました"

# ============================================================
# 11. GitHub Actions 用 IAM ロールの作成
# ============================================================

info "GitHub Actions 用 OIDC プロバイダーを作成しています..."

# 既に存在する場合はスキップ
OIDC_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" &>/dev/null; then
  aws iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
    --output text > /dev/null
  ok "OIDC プロバイダーを作成しました"
else
  ok "OIDC プロバイダーは既に存在します"
fi

info "GitHub Actions 用 IAM ロールを作成しています..."

DEPLOY_TRUST_POLICY=$(cat <<TRUST
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO_FULL}:ref:refs/heads/main"
        }
      }
    }
  ]
}
TRUST
)

DEPLOY_ROLE_ARN=$(aws iam create-role \
  --role-name "$DEPLOY_ROLE_NAME" \
  --assume-role-policy-document "$DEPLOY_TRUST_POLICY" \
  --query 'Role.Arn' --output text)

DEPLOY_PERMISSIONS=$(cat <<PERMS
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Lambda",
      "Effect": "Allow",
      "Action": ["lambda:UpdateFunctionCode"],
      "Resource": "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:${FUNCTION_NAME}"
    },
    {
      "Sid": "S3",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::${BUCKET_NAME}",
        "arn:aws:s3:::${BUCKET_NAME}/*"
      ]
    },
    {
      "Sid": "CloudFront",
      "Effect": "Allow",
      "Action": ["cloudfront:CreateInvalidation"],
      "Resource": "arn:aws:cloudfront::${AWS_ACCOUNT_ID}:distribution/${DIST_ID}"
    }
  ]
}
PERMS
)

aws iam put-role-policy \
  --role-name "$DEPLOY_ROLE_NAME" \
  --policy-name quill-deploy-permissions \
  --policy-document "$DEPLOY_PERMISSIONS"

ok "GitHub Actions ロール: $DEPLOY_ROLE_ARN"

# ============================================================
# 12. 設定値の保存
# ============================================================

cat > "$OUTPUT_FILE" <<OUT
# Quill デプロイ情報 ($(date '+%Y-%m-%d %H:%M:%S'))
# ============================================================

AWS_REGION=$AWS_REGION
AWS_ACCOUNT_ID=$AWS_ACCOUNT_ID

# Lambda
LAMBDA_FUNCTION_NAME=$FUNCTION_NAME
LAMBDA_ARN=$LAMBDA_ARN

# API Gateway
API_ID=$API_ID
API_URL=$API_URL

# S3
S3_BUCKET_NAME=$BUCKET_NAME

# CloudFront
CLOUDFRONT_DISTRIBUTION_ID=$DIST_ID
CLOUDFRONT_DOMAIN=$DIST_DOMAIN
FRONTEND_URL=$FRONTEND_URL

# GitHub Actions IAM ロール
DEPLOY_ROLE_ARN=$DEPLOY_ROLE_ARN
OUT

# ============================================================
# 13. 完了サマリー
# ============================================================

echo ""
echo "========================================="
echo "  セットアップ完了"
echo "========================================="
echo ""
echo "フロントエンド URL : $FRONTEND_URL"
echo "API URL            : $API_URL"
echo ""
echo "-----------------------------------------"
echo "  GitHub OAuth App の設定を更新してください"
echo "-----------------------------------------"
echo ""
echo "  Homepage URL              : $FRONTEND_URL"
echo "  Authorization callback URL: ${API_URL}/auth/callback"
echo ""
echo "-----------------------------------------"
echo "  GitHub Actions の Secrets / Variables"
echo "-----------------------------------------"
echo ""
echo "  [Secrets]"
echo "  AWS_ROLE_ARN              = $DEPLOY_ROLE_ARN"
echo ""
echo "  [Variables]"
echo "  AWS_REGION                = $AWS_REGION"
echo "  LAMBDA_FUNCTION_NAME      = $FUNCTION_NAME"
echo "  S3_BUCKET_NAME            = $BUCKET_NAME"
echo "  CLOUDFRONT_DISTRIBUTION_ID= $DIST_ID"
echo "  VITE_API_BASE             = $API_URL"
echo ""
echo "設定値は $OUTPUT_FILE に保存しました。"
echo ""

ok "デプロイが完了しました！"
