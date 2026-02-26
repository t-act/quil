# Plan：Markdown Editor → GitHub Commit Web App

## プロジェクト概要

スマホ・PCどちらからでも、自分のGitHubリポジトリにあるMarkdownファイルを
編集・作成・削除してcommitできるWebアプリ。

不特定多数に公開し、GitHub OAuthで各ユーザーが自分のアカウントで利用する。

---

## ユーザーストーリー

- ユーザーはGitHub OAuthでログインする
- ログイン後、自分のGitHubリポジトリ一覧から編集したいリポジトリを選ぶ
- リポジトリ内の `.md` ファイル一覧が表示される
- ファイルを選択してMarkdownを編集（編集/プレビュー切り替え）
- 任意でコミットメッセージを入力し（空欄なら自動生成）、commitする
- よく使うリポジトリはピン留め、よく使うファイルはお気に入り登録できる
- 最近開いたファイルはショートカットからすぐアクセスできる

---

## 技術スタック

### quill（フロントエンド）
| 項目 | 技術 |
|------|------|
| フレームワーク | React + Vite + TypeScript |
| エディタ | @uiw/react-md-editor |
| スタイル | TBD（Tailwind CSS 推奨） |
| デプロイ | S3 + CloudFront |

### courier（バックエンド）
| 項目 | 技術 |
|------|------|
| フレームワーク | FastAPI |
| 実行環境 | AWS Lambda + API Gateway |
| 認証 | GitHub OAuth 2.0 |
| DB | DynamoDB（ユーザーデータ管理） |
| デプロイ | Lambda（Mangum経由） |

---

## アーキテクチャ

```
[ユーザー（スマホ/PC）]
        │
        ▼
[CloudFront + S3]  ← quill（React）
        │
        │ API呼び出し
        ▼
[API Gateway]
        │
        ▼
[Lambda]  ← courier（FastAPI + Mangum）
    │         │
    │         ▼
    │     [DynamoDB]  ← お気に入り / 最近開いたファイル / ピン留めリポジトリ
    │
    ▼
[GitHub API]  ← ファイル取得 / コミット
```

---

## 機能一覧

### Phase 1：認証基盤
- [ ] GitHub OAuth 2.0 フロー実装（courier）
- [ ] アクセストークンの安全な管理（セッション or JWT）
- [ ] ログイン・ログアウト画面（quill）

### Phase 2：コアエディタ機能
- [ ] リポジトリ一覧取得・表示
- [ ] ファイル一覧取得・表示（.md のみ）
- [ ] ファイル内容取得・表示
- [ ] Markdownエディタ（編集 / プレビュー 切り替え）
- [ ] ファイル保存（commit）
  - コミットメッセージ任意入力（空欄なら `Update <filename>` を自動生成）
- [ ] 新規ファイル作成
- [ ] ファイル削除

### Phase 3：ショートカット機能
- [ ] 最近開いたファイル（Recent） ← DynamoDB
- [ ] お気に入りファイル（Favorites） ← DynamoDB
- [ ] よく使うリポジトリのピン留め ← DynamoDB

### Phase 4：UX・レスポンシブ
- [ ] スマホ / PC 両対応レイアウト
- [ ] ローディング表示
- [ ] エラーハンドリング・トースト通知
- [ ] 未保存変更の離脱警告

### Phase 5：デプロイ
- [ ] courier を Lambda にデプロイ（Mangum）
- [ ] quill を S3 + CloudFront にデプロイ
- [ ] 環境変数・シークレット管理（AWS Secrets Manager or Parameter Store）
- [ ] カスタムドメイン設定（任意）

---

## 画面構成

```
/ (ログイン画面)
  └─ GitHubでログイン ボタン

/dashboard (ダッシュボード)
  ├─ ピン留めリポジトリ
  ├─ 最近開いたファイル
  └─ お気に入りファイル

/repos (リポジトリ一覧)
  └─ /repos/:owner/:repo (ファイル一覧)
        └─ /repos/:owner/:repo/edit?path=xxx.md (エディタ)
```

---

## データモデル（DynamoDB）

### テーブル：`users`
| キー | 型 | 説明 |
|------|----|------|
| `userId` (PK) | String | GitHub user ID |
| `accessToken` | String | GitHub OAuth アクセストークン |
| `pinnedRepos` | List | ピン留めリポジトリ |
| `favorites` | List | お気に入りファイル `{repo, path}` |
| `recents` | List | 最近開いたファイル `{repo, path, openedAt}` |

---

## 未決定事項（TODO）

- [ ] セッション管理方式：JWT（stateless）vs セッションCookie
- [ ] アクセストークンの暗号化保存をどうするか
- [ ] ドメイン名
- [ ] OSSとして公開するか否か
