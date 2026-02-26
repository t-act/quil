import os
import secrets

import requests
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

from .session import SESSION_COOKIE, SESSION_TTL, SessionData, create_session, get_session

router = APIRouter(prefix="/auth")

GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"
OAUTH_STATE_COOKIE = "oauth_state"


def _client_id() -> str:
    v = os.getenv("GITHUB_CLIENT_ID")
    if not v:
        raise RuntimeError("GITHUB_CLIENT_ID is required")
    return v


def _client_secret() -> str:
    v = os.getenv("GITHUB_CLIENT_SECRET")
    if not v:
        raise RuntimeError("GITHUB_CLIENT_SECRET is required")
    return v


def _callback_url() -> str:
    return os.getenv("OAUTH_CALLBACK_URL", "http://localhost:8000/auth/callback")


def _frontend_origin() -> str:
    return os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")


def _is_production() -> bool:
    return os.getenv("ENV", "development") == "production"


@router.get("/login")
def login():
    state = secrets.token_urlsafe(32)
    params = (
        f"?client_id={_client_id()}"
        f"&redirect_uri={_callback_url()}"
        f"&scope=repo"
        f"&state={state}"
    )
    response = RedirectResponse(url=GITHUB_AUTHORIZE_URL + params)
    response.set_cookie(
        OAUTH_STATE_COOKIE,
        state,
        httponly=True,
        samesite="lax",
        secure=_is_production(),
        max_age=600,
    )
    return response


@router.get("/callback")
def callback(request: Request, code: str, state: str):
    stored_state = request.cookies.get(OAUTH_STATE_COOKIE)
    if not stored_state or stored_state != state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

    # code → access_token
    token_resp = requests.post(
        GITHUB_TOKEN_URL,
        headers={"Accept": "application/json"},
        data={
            "client_id": _client_id(),
            "client_secret": _client_secret(),
            "code": code,
            "redirect_uri": _callback_url(),
        },
        timeout=15,
    )
    token_resp.raise_for_status()
    token_data = token_resp.json()
    access_token = token_data.get("access_token")
    if not access_token:
        github_error = token_data.get("error_description") or token_data.get("error") or str(token_data)
        raise HTTPException(status_code=500, detail=f"GitHub token error: {github_error}")

    # ユーザー情報取得
    user_resp = requests.get(
        GITHUB_USER_URL,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
        },
        timeout=15,
    )
    user_resp.raise_for_status()
    user_data = user_resp.json()

    session_data = SessionData(
        github_access_token=access_token,
        github_login=user_data["login"],
        github_avatar_url=user_data.get("avatar_url", ""),
    )
    session_cookie = create_session(session_data)

    response = RedirectResponse(url=_frontend_origin() + "/")
    response.delete_cookie(OAUTH_STATE_COOKIE)
    response.set_cookie(
        SESSION_COOKIE,
        session_cookie,
        httponly=True,
        samesite="lax",
        secure=_is_production(),
        max_age=SESSION_TTL,
    )
    return response


@router.get("/me")
def me(request: Request):
    session = get_session(request)
    return {
        "login": session.github_login,
        "avatar_url": session.github_avatar_url,
    }


@router.post("/logout")
def logout():
    response = Response(content='{"message": "logged out"}', media_type="application/json")
    response.delete_cookie(SESSION_COOKIE)
    return response
