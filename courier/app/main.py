import os

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from . import github
from .auth import router as auth_router
from .session import SessionData, get_session

load_dotenv()

app = FastAPI(title="Markdown Editor GitHub API", root_path="/api")

origins = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)


class CommitRequest(BaseModel):
    owner: str = Field(..., description="Repository owner")
    repo: str = Field(..., description="Repository name")
    branch: str = Field("main", description="Branch name")
    path: str = Field(..., description="Repository path to the markdown file")
    content: str = Field(..., description="Full markdown content")
    message: str = Field("", description="Commit message (auto-generated if empty)")


class CreateFileRequest(BaseModel):
    owner: str
    repo: str
    branch: str = "main"
    path: str
    content: str = ""
    message: str = ""


class DeleteFileRequest(BaseModel):
    owner: str
    repo: str
    branch: str = "main"
    path: str
    message: str = ""


@app.get("/repos")
def get_repos(session: SessionData = Depends(get_session)):
    try:
        repos = github.list_user_repos(session.github_access_token)
        return {"repos": repos}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/files")
def get_files(
    owner: str = Query(...),
    repo: str = Query(...),
    branch: str = Query("main"),
    session: SessionData = Depends(get_session),
):
    try:
        files = github.list_markdown_files(session.github_access_token, owner, repo, branch)
        return {"files": files}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/file")
def get_file(
    owner: str = Query(...),
    repo: str = Query(...),
    path: str = Query(...),
    branch: str = Query("main"),
    session: SessionData = Depends(get_session),
):
    try:
        content = github.get_file_content(path, session.github_access_token, owner, repo, branch)
        return {"path": path, "content": content}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/commit")
def post_commit(payload: CommitRequest, session: SessionData = Depends(get_session)):
    try:
        result = github.commit_file(
            payload.path,
            payload.content,
            payload.message,
            session.github_access_token,
            payload.owner,
            payload.repo,
            payload.branch,
        )
        return {
            "path": payload.path,
            "commit": result.get("commit"),
            "content": result.get("content"),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/files/create")
def post_create_file(payload: CreateFileRequest, session: SessionData = Depends(get_session)):
    try:
        result = github.create_file(
            payload.path,
            payload.content,
            payload.message,
            session.github_access_token,
            payload.owner,
            payload.repo,
            payload.branch,
        )
        return {"path": payload.path, "commit": result.get("commit")}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/files/delete")
def post_delete_file(payload: DeleteFileRequest, session: SessionData = Depends(get_session)):
    try:
        result = github.delete_file(
            payload.path,
            payload.message,
            session.github_access_token,
            payload.owner,
            payload.repo,
            payload.branch,
        )
        return {"path": payload.path, "commit": result.get("commit")}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# AWS Lambda handler
handler = Mangum(app)
