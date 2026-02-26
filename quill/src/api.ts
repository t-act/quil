const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'

export class AuthError extends Error {
  constructor() {
    super('Not authenticated')
    this.name = 'AuthError'
  }
}

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, { credentials: 'include', ...init })
  if (res.status === 401) throw new AuthError()
  return res
}

// ---- Auth ----

export type UserResponse = { login: string; avatar_url: string }

export async function fetchMe(): Promise<UserResponse> {
  const res = await apiFetch(`${API_BASE}/auth/me`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function logout(): Promise<void> {
  await apiFetch(`${API_BASE}/auth/logout`, { method: 'POST' })
}

// ---- Repos ----

export type RepoInfo = {
  full_name: string
  name: string
  owner: string
  private: boolean
  default_branch: string
}

export async function fetchRepos(): Promise<{ repos: RepoInfo[] }> {
  const res = await apiFetch(`${API_BASE}/repos`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ---- Files ----

export type FileListResponse = { files: string[] }
export type FileResponse = { path: string; content: string }
export type CommitResponse = { path: string; commit?: unknown; content?: unknown }

export async function fetchFiles(owner: string, repo: string, branch: string): Promise<FileListResponse> {
  const url = new URL(`${API_BASE}/files`)
  url.searchParams.set('owner', owner)
  url.searchParams.set('repo', repo)
  url.searchParams.set('branch', branch)
  const res = await apiFetch(url)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function fetchFile(owner: string, repo: string, path: string, branch: string): Promise<FileResponse> {
  const url = new URL(`${API_BASE}/file`)
  url.searchParams.set('owner', owner)
  url.searchParams.set('repo', repo)
  url.searchParams.set('path', path)
  url.searchParams.set('branch', branch)
  const res = await apiFetch(url)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function commitFile(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  content: string,
  message: string,
): Promise<CommitResponse> {
  const res = await apiFetch(`${API_BASE}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, repo, branch, path, content, message }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function createFile(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  content: string,
  message: string,
): Promise<CommitResponse> {
  const res = await apiFetch(`${API_BASE}/files/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, repo, branch, path, content, message }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function deleteFile(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  message: string,
): Promise<CommitResponse> {
  const res = await apiFetch(`${API_BASE}/files/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, repo, branch, path, message }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
