# Markdown Editor → GitHub Commit Web App

## Backend (FastAPI)

1. `backend/.env.example` を `backend/.env` にコピーして設定
2. 依存関係をインストール

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

3. 起動

```bash
uvicorn backend.app.main:app --reload
```

## Frontend (Vite + React)

1. `frontend/.env.example` を `frontend/.env` にコピーして設定
2. 依存関係をインストール

```bash
cd frontend
npm install
```

3. 起動

```bash
npm run dev
```
