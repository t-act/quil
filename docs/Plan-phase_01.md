# Phase 1：GitHub OAuth 実装計画

## Context

現在の courier は環境変数の固定 `GITHUB_TOKEN` / `GITHUB_OWNER` / `GITHUB_REPO` で動いている。
不特定多数ユーザーが自分のアカウントでログインして任意のリポジトリを操作できるよう、
GitHub OAuth 2.0 に全面移行する。セッションは Fernet 暗号化 httpOnly Cookie で管理（Lambda のステートレス性に適合、DynamoDB 不要）。

---

## 変更ファイル一覧

### courier（新規作成）
- `courier/app/session.py` — Fernet Cookie 暗号化・復号・依存性注入
- `courier/app/auth.py` — OAuth フロー（/auth/login, /auth/callback, /auth/me, /auth/logout）

### courier（修正）
- `courier/app/github.py` — 固定環境変数 → `token/owner/repo` 引数化、`list_user_repos()` 追加
- `courier/app/main.py` — authルーター登録、CORS修正、既存エンドポイントにセッション依存性追加
- `courier/requirements.txt` — `cryptography`, `mangum` 追加

### quill（新規作成）
- `quill/src/useAuth.ts` — 認証状態管理 hook
- `quill/src/LoginPage.tsx` — ログイン画面
- `quill/src/EditorPage.tsx` — 現 App.tsx の中身を移植（owner/repo 選択UI追加）

### quill（修正）
- `quill/src/App.tsx` — ルーティングハブに変更（react-router-dom）
- `quill/src/api.ts` — `credentials: 'include'` 追加、auth系API追加、全関数にowner/repo追加
- `quill/package.json` — `react-router-dom` 追加

---

## 実装詳細

### 1. `courier/app/session.py`（新規）

```python
SESSION_COOKIE = "md_editor_session"
SESSION_TTL = 8 * 60 * 60  # 8時間

@dataclass
class SessionData:
    github_access_token: str
    github_login: str
    github_avatar_url: str

def create_session(data: SessionData) -> str   # Fernet暗号化 → str
def decode_session(cookie: str) -> SessionData  # 復号 → SessionData
def get_session(request: Request) -> SessionData  # FastAPI Depends用、失敗→HTTP 401
```

環境変数 `SESSION_SECRET_KEY`（Fernet形式44文字）を起動時に読む。
**起動ごとに generate_key() してはいけない** → Lambda コールドスタートで全Cookie無効になる。

### 2. `courier/app/auth.py`（新規）

```python
router = APIRouter(prefix="/auth")
```

| エンドポイント | 内容 |
|---|---|
| `GET /auth/login` | GitHub OAuth URLへリダイレクト、`oauth_state` Cookie設定 |
| `GET /auth/callback` | code→token交換、session Cookie設定、フロントにリダイレクト |
| `GET /auth/me` | SessionDataからlogin/avatar_urlを返す |
| `POST /auth/logout` | session Cookieを削除 |

CSRF対策：`secrets.token_urlsafe(32)` で state 生成 → Cookie保存 → callback時に照合。

```python
# CALLBACK_URLは環境変数から（ハードコード禁止）
callback_url = os.getenv("OAUTH_CALLBACK_URL", "http://localhost:8000/auth/callback")
```

### 3. `courier/app/github.py`（修正）

全関数のシグネチャを変更：

```python
# 変更前
def list_markdown_files() -> list[str]:
# 変更後
def list_markdown_files(token: str, owner: str, repo: str) -> list[str]:
```

新規追加：
```python
def list_user_repos(token: str) -> list[dict]:
    # GET https://api.github.com/user/repos?sort=updated&per_page=100
    # 返却: [{full_name, name, owner, private, default_branch}, ...]
```

### 4. `courier/app/main.py`（修正）

**CORS修正**：`allow_origins=["*"]` → 環境変数 `FRONTEND_ORIGIN` のリスト
（`credentials: 'include'` はワイルドカードoriginと共存不可）

```python
origins = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173").split(",")
```

**CommitRequest 拡張**：

```python
class CommitRequest(BaseModel):
    owner: str   # 追加
    repo: str    # 追加
    path: str
    content: str
    message: str = ""  # 空なら "Update <filename>" を自動生成
```

**既存エンドポイントにセッション依存性追加**：

```python
@app.get("/files")
def get_files(owner: str, repo: str, session: SessionData = Depends(get_session)):
    return {"files": github.list_markdown_files(session.github_access_token, owner, repo)}
```

### 5. `quill/src/api.ts`（修正）

- 全 fetch に `credentials: 'include'` を追加
- `/files`, `/file`, `/commit` に `owner`, `repo` を追加
- 新規追加：`fetchMe()`, `fetchRepos()`, `logout()`
- 401 → `AuthError` をthrowする規約を導入（呼び出し側でログイン画面へ遷移）

### 6. `quill/src/useAuth.ts`（新規）

```typescript
export function useAuth() {
  // マウント時に GET /auth/me を呼ぶ
  // 200 → user にセット
  // 401 → user = null
  // logout() → POST /auth/logout → リロード
  return { user, loading, logout }
}
```

### 7. `quill/src/App.tsx`（修正）

```tsx
const { user, loading } = useAuth()
// loading中 → スピナー
// user あり → EditorPage
// user なし → LoginPage
```

react-router-dom を使う（`npm install react-router-dom`）。

### 8. `quill/src/EditorPage.tsx`（新規）

現 App.tsx の中身を移植し、以下を追加：
- `/repos` APIでリポジトリ一覧を取得してselect表示
- `owner`, `repo` の選択状態を持つ
- ヘッダーにアバター＋ログアウトボタン

---

## 環境変数

### courier/.env（ローカル）
```
GITHUB_CLIENT_ID=Ov23li...
GITHUB_CLIENT_SECRET=xxxx...
OAUTH_CALLBACK_URL=http://localhost:8000/auth/callback
FRONTEND_ORIGIN=http://localhost:5173
SESSION_SECRET_KEY=（下記コマンドで生成）
```

SESSION_SECRET_KEY 生成：
```python
from cryptography.fernet import Fernet
print(Fernet.generate_key().decode())
```

---

## GitHub OAuth App 事前設定（手動）

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. ローカル用：Callback URL = `http://localhost:8000/auth/callback`
3. Client ID と Client Secret を .env に設定

> 本番用は別の OAuth App を作成する（Callback URL が異なるため）

---

## 実装順序

1. `session.py` — 単体でencrypt/decrypt確認
2. `auth.py` — `/auth/login` → `/auth/callback` の流れを通す
3. `github.py` — 引数化リファクタリング
4. `main.py` — ルーター登録・CORS修正・Depends追加
5. `api.ts` + `useAuth.ts` — フロント認証基盤
6. `LoginPage.tsx` — ログイン画面
7. `EditorPage.tsx` — 既存UIを移植しowner/repo選択追加
8. `App.tsx` — ルーティングハブ化

---

## 落とし穴メモ

| 問題 | 対処 |
|---|---|
| `allow_origins=["*"]` + `credentials=True` はCORSエラー | originsを具体的に指定 |
| Lambda起動ごとに `Fernet.generate_key()` するとCookie全無効 | 環境変数から固定キーを読む |
| state検証省略はCSRF脆弱性 | 一時Cookie照合を実装 |
| API GatewayのCallback URLが1文字でも違うとOAuthエラー | `OAUTH_CALLBACK_URL` を環境変数化 |
| ローカルのCookie SameSite=None はHTTPS必須 | 開発時は `SameSite=Lax` / `Secure=False` |
| S3+CloudFrontでの `/login` 直アクセスが404 | CloudFront Error Pagesで404→index.html（200）を設定 |

---

## 動作確認

1. `uvicorn app.main:app --reload` と `npm run dev` を起動
2. `http://localhost:5173` → LoginPage が表示される
3. "GitHubでログイン" → GitHub認証 → EditorPage が表示される
4. リポジトリを選択 → .md ファイル一覧 → 編集 → commit が成功する
5. ログアウト → LoginPage に戻る
6. `http://localhost:5173/` を直接アクセス → 未ログインなら LoginPage に遷移する
