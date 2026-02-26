import base64
from typing import List

import requests

GITHUB_API = "https://api.github.com"


def _headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _repo_base(owner: str, repo: str) -> str:
    return f"{GITHUB_API}/repos/{owner}/{repo}"


def list_user_repos(token: str) -> List[dict]:
    resp = requests.get(
        f"{GITHUB_API}/user/repos",
        headers=_headers(token),
        params={"sort": "updated", "per_page": 100},
        timeout=20,
    )
    resp.raise_for_status()
    return [
        {
            "full_name": r["full_name"],
            "name": r["name"],
            "owner": r["owner"]["login"],
            "private": r["private"],
            "default_branch": r.get("default_branch", "main"),
        }
        for r in resp.json()
    ]


def list_markdown_files(token: str, owner: str, repo: str, branch: str = "main") -> List[str]:
    url = f"{_repo_base(owner, repo)}/git/trees/{branch}"
    resp = requests.get(url, headers=_headers(token), params={"recursive": "1"}, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    files = [
        item["path"]
        for item in data.get("tree", [])
        if item.get("type") == "blob" and item.get("path", "").endswith(".md")
    ]
    return sorted(files)


def get_file_content(path: str, token: str, owner: str, repo: str, branch: str = "main") -> str:
    url = f"{_repo_base(owner, repo)}/contents/{path}"
    resp = requests.get(url, headers=_headers(token), params={"ref": branch}, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    if data.get("encoding") != "base64":
        raise RuntimeError("Unexpected content encoding from GitHub")
    raw = base64.b64decode(data.get("content", ""))
    return raw.decode("utf-8")


def _get_file_sha(path: str, token: str, owner: str, repo: str, branch: str = "main") -> str:
    url = f"{_repo_base(owner, repo)}/contents/{path}"
    resp = requests.get(url, headers=_headers(token), params={"ref": branch}, timeout=20)
    resp.raise_for_status()
    sha = resp.json().get("sha")
    if not sha:
        raise RuntimeError("Unable to fetch file sha")
    return sha


def commit_file(
    path: str,
    content: str,
    message: str,
    token: str,
    owner: str,
    repo: str,
    branch: str = "main",
) -> dict:
    url = f"{_repo_base(owner, repo)}/contents/{path}"
    payload = {
        "message": message or f"Update {path}",
        "content": base64.b64encode(content.encode("utf-8")).decode("utf-8"),
        "sha": _get_file_sha(path, token, owner, repo, branch),
        "branch": branch,
    }
    resp = requests.put(url, headers=_headers(token), json=payload, timeout=20)
    resp.raise_for_status()
    return resp.json()


def create_file(
    path: str,
    content: str,
    message: str,
    token: str,
    owner: str,
    repo: str,
    branch: str = "main",
) -> dict:
    url = f"{_repo_base(owner, repo)}/contents/{path}"
    payload = {
        "message": message or f"Create {path}",
        "content": base64.b64encode(content.encode("utf-8")).decode("utf-8"),
        "branch": branch,
    }
    resp = requests.put(url, headers=_headers(token), json=payload, timeout=20)
    resp.raise_for_status()
    return resp.json()


def delete_file(
    path: str,
    message: str,
    token: str,
    owner: str,
    repo: str,
    branch: str = "main",
) -> dict:
    url = f"{_repo_base(owner, repo)}/contents/{path}"
    payload = {
        "message": message or f"Delete {path}",
        "sha": _get_file_sha(path, token, owner, repo, branch),
        "branch": branch,
    }
    resp = requests.delete(url, headers=_headers(token), json=payload, timeout=20)
    resp.raise_for_status()
    return resp.json()
