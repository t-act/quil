const GITHUB_API = 'https://api.github.com'

export interface RepoInfo {
  full_name: string
  name: string
  owner: string
  private: boolean
  default_branch: string
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub API は User-Agent 必須。Lambda では requests が自動付与していたが fetch は付けないため明示する。
    'User-Agent': 'quill-md-editor',
  }
}

function repoBase(owner: string, repo: string): string {
  return `${GITHUB_API}/repos/${owner}/${repo}`
}

async function ghFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...headers(token), ...(init?.headers ?? {}) } })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub API ${res.status}: ${body}`)
  }
  return res
}

export async function listUserRepos(token: string): Promise<RepoInfo[]> {
  const res = await ghFetch(`${GITHUB_API}/user/repos?sort=updated&per_page=100`, token)
  const repos = (await res.json()) as any[]
  return repos.map((r) => ({
    full_name: r.full_name,
    name: r.name,
    owner: r.owner.login,
    private: r.private,
    default_branch: r.default_branch ?? 'main',
  }))
}

export async function listMarkdownFiles(
  token: string,
  owner: string,
  repo: string,
  branch = 'main',
): Promise<string[]> {
  const res = await ghFetch(`${repoBase(owner, repo)}/git/trees/${branch}?recursive=1`, token)
  const data = (await res.json()) as any
  const tree = (data.tree ?? []) as any[]
  return tree
    .filter((item) => item.type === 'blob' && typeof item.path === 'string' && item.path.endsWith('.md'))
    .map((item) => item.path as string)
    .sort()
}

export async function getFileContent(
  path: string,
  token: string,
  owner: string,
  repo: string,
  branch = 'main',
): Promise<string> {
  const url = `${repoBase(owner, repo)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`
  const res = await ghFetch(url, token)
  const data = (await res.json()) as any
  if (data.encoding !== 'base64') {
    throw new Error('Unexpected content encoding from GitHub')
  }
  // GitHub は改行入りの base64 を返すため、そのまま atob できるよう改行を除去してからデコードする。
  const bin = atob(String(data.content ?? '').replace(/\n/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

async function getFileSha(
  path: string,
  token: string,
  owner: string,
  repo: string,
  branch = 'main',
): Promise<string> {
  const url = `${repoBase(owner, repo)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`
  const res = await ghFetch(url, token)
  const data = (await res.json()) as any
  if (!data.sha) {
    throw new Error('Unable to fetch file sha')
  }
  return data.sha as string
}

// UTF-8 文字列を base64 化する。btoa は Latin-1 前提なので、一度 UTF-8 バイト列へ変換してから通す。
function toBase64(content: string): string {
  const bytes = new TextEncoder().encode(content)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export async function commitFile(
  path: string,
  content: string,
  message: string,
  token: string,
  owner: string,
  repo: string,
  branch = 'main',
): Promise<any> {
  const url = `${repoBase(owner, repo)}/contents/${encodeURIComponent(path)}`
  const res = await ghFetch(url, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: message || `Update ${path}`,
      content: toBase64(content),
      sha: await getFileSha(path, token, owner, repo, branch),
      branch,
    }),
  })
  return res.json()
}

export async function createFile(
  path: string,
  content: string,
  message: string,
  token: string,
  owner: string,
  repo: string,
  branch = 'main',
): Promise<any> {
  const url = `${repoBase(owner, repo)}/contents/${encodeURIComponent(path)}`
  const res = await ghFetch(url, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: message || `Create ${path}`,
      content: toBase64(content),
      branch,
    }),
  })
  return res.json()
}

export async function deleteFile(
  path: string,
  message: string,
  token: string,
  owner: string,
  repo: string,
  branch = 'main',
): Promise<any> {
  const url = `${repoBase(owner, repo)}/contents/${encodeURIComponent(path)}`
  const res = await ghFetch(url, token, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: message || `Delete ${path}`,
      sha: await getFileSha(path, token, owner, repo, branch),
      branch,
    }),
  })
  return res.json()
}
