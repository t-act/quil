import json
import os
from dataclasses import dataclass

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException, Request

SESSION_COOKIE = "md_editor_session"
SESSION_TTL = 8 * 60 * 60  # 8時間（秒）


@dataclass
class SessionData:
    github_access_token: str
    github_login: str
    github_avatar_url: str


def _get_fernet() -> Fernet:
    key = os.getenv("SESSION_SECRET_KEY")
    if not key:
        raise RuntimeError("SESSION_SECRET_KEY is required")
    return Fernet(key.encode())


def create_session(data: SessionData) -> str:
    payload = json.dumps({
        "github_access_token": data.github_access_token,
        "github_login": data.github_login,
        "github_avatar_url": data.github_avatar_url,
    }).encode()
    return _get_fernet().encrypt(payload).decode()


def decode_session(cookie: str) -> SessionData:
    try:
        payload = _get_fernet().decrypt(cookie.encode(), ttl=SESSION_TTL)
        data = json.loads(payload)
        return SessionData(
            github_access_token=data["github_access_token"],
            github_login=data["github_login"],
            github_avatar_url=data["github_avatar_url"],
        )
    except InvalidToken as exc:
        raise HTTPException(status_code=401, detail="Session expired or invalid") from exc
    except (KeyError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=401, detail="Malformed session") from exc


def get_session(request: Request) -> SessionData:
    cookie = request.cookies.get(SESSION_COOKIE)
    if not cookie:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return decode_session(cookie)
