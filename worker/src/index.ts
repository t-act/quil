import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'

import type { Env } from './types'
import { auth } from './auth'
import * as github from './github'
import { requireSession } from './session'

const api = new Hono<{ Bindings: Env }>()

api.route('/auth', auth)

api.get('/repos', async (c) => {
  const session = await requireSession(c)
  const repos = await github.listUserRepos(session.github_access_token)
  return c.json({ repos })
})

api.get('/files', async (c) => {
  const session = await requireSession(c)
  const owner = c.req.query('owner')
  const repo = c.req.query('repo')
  const branch = c.req.query('branch') ?? 'main'
  if (!owner || !repo) {
    throw new HTTPException(400, { message: 'owner and repo are required' })
  }
  const files = await github.listMarkdownFiles(session.github_access_token, owner, repo, branch)
  return c.json({ files })
})

api.get('/file', async (c) => {
  const session = await requireSession(c)
  const owner = c.req.query('owner')
  const repo = c.req.query('repo')
  const path = c.req.query('path')
  const branch = c.req.query('branch') ?? 'main'
  if (!owner || !repo || !path) {
    throw new HTTPException(400, { message: 'owner, repo and path are required' })
  }
  const content = await github.getFileContent(path, session.github_access_token, owner, repo, branch)
  return c.json({ path, content })
})

api.post('/commit', async (c) => {
  const session = await requireSession(c)
  const body = (await c.req.json()) as any
  const { owner, repo, path } = body
  if (!owner || !repo || !path) {
    throw new HTTPException(400, { message: 'owner, repo and path are required' })
  }
  const result = await github.commitFile(
    path,
    body.content ?? '',
    body.message ?? '',
    session.github_access_token,
    owner,
    repo,
    body.branch ?? 'main',
  )
  return c.json({ path, commit: result.commit, content: result.content })
})

api.post('/files/create', async (c) => {
  const session = await requireSession(c)
  const body = (await c.req.json()) as any
  const { owner, repo, path } = body
  if (!owner || !repo || !path) {
    throw new HTTPException(400, { message: 'owner, repo and path are required' })
  }
  const result = await github.createFile(
    path,
    body.content ?? '',
    body.message ?? '',
    session.github_access_token,
    owner,
    repo,
    body.branch ?? 'main',
  )
  return c.json({ path, commit: result.commit })
})

api.post('/files/delete', async (c) => {
  const session = await requireSession(c)
  const body = (await c.req.json()) as any
  const { owner, repo, path } = body
  if (!owner || !repo || !path) {
    throw new HTTPException(400, { message: 'owner, repo and path are required' })
  }
  const result = await github.deleteFile(
    path,
    body.message ?? '',
    session.github_access_token,
    owner,
    repo,
    body.branch ?? 'main',
  )
  return c.json({ path, commit: result.commit })
})

const app = new Hono<{ Bindings: Env }>()

app.route('/api', api)

// /api 以外は静的アセットへ委譲する。Static Assets の not_found_handling=single-page-application により、
// クライアントサイドルーティング用のパスは index.html にフォールバックされる（旧 CloudFront の 403/404→index.html 相当）。
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

// FastAPI が例外を {detail: ...} で返していたため、フロントの表示挙動を変えないよう同じ形状に揃える。
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ detail: err.message }, err.status)
  }
  return c.json({ detail: err instanceof Error ? err.message : String(err) }, 500)
})

export default app
