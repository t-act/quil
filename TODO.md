# MVP TODOリスト：Markdown Editor → GitHub Commit Web App

## ゴール
- スマホのWebブラウザから
- GitHub上の特定リポジトリにあるMarkdownファイルを
- 編集してcommitできる

---

## Phase 0：事前準備

- [ ] GitHubに編集用リポジトリを作成
- [ ] Markdownファイル（例：test.md）を1つ追加
- [ ] Personal Access Token を作成（repo権限）
- [ ] Tokenを安全な場所に保存

---

## Phase 1：Backend（FastAPI）

### 環境構築
- [ ] backendディレクトリ作成
- [ ] Python venv作成
- [ ] fastapi / uvicorn / requests をインストール

### 環境変数
- [ ] GITHUB_TOKEN を設定
- [ ] GITHUB_OWNER を設定
- [ ] GITHUB_REPO を設定
- [ ] GITHUB_BRANCH（任意、default: main）

### API実装
- [ ] GET /files
  - リポジトリ内の .md ファイル一覧を取得
- [ ] GET /file?path=xxx.md
  - Markdownファイルの中身を取得
- [ ] POST /commit
  - 編集後のMarkdownをGitHubにcommit

### その他
- [ ] base64デコード処理
- [ ] CORS設定（MVPでは全許可でも可）
- [ ] Swagger UIで動作確認

---

## Phase 2：Frontend（React + Vite + TS）

### 環境構築
- [ ] frontendディレクトリ作成
- [ ] Vite + React + TypeScript プロジェクト作成
- [ ] スマホ表示前提のレイアウト確認

### UI実装
- [ ] Markdown Editor導入（@uiw/react-md-editor）
- [ ] mdファイル一覧画面
- [ ] ファイル選択時に内容取得
- [ ] Markdown編集画面

### API連携
- [ ] /files API 呼び出し
- [ ] /file API 呼び出し
- [ ] /commit API 呼び出し
- [ ] 成功／失敗の簡易メッセージ表示

---

## Phase 3：最低限UX

- [ ] ローディング表示
- [ ] エラー時のアラート表示

---

## Phase 4：デプロイ（後回し可）

### Backend
- [ ] ローカルで安定動作確認
- [ ] AWS（Lambda or EC2）にデプロイ
- [ ] 環境変数を本番用に設定

### Frontend
- [ ] vite build
- [ ] S3 + CloudFront または Vercel にデプロイ

---

## MVP達成条件

- [ ] スマホでMarkdownを編集できる
- [ ] GitHubにcommitが成功する
- [ ] commit内容がリポジトリに反映されている

→ ここまでできたらMVP完成
