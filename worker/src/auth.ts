import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'

import type { Env } from './types'
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL,
  createSession,
  requireSession,
} from './session'

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_USER_URL = 'https://api.github.com/user'

function isProduction(env: Env): boolean {
  return env.ENV === 'production'
}

// secrets.token_urlsafe(32) 相当。CSRF 対策の state に十分なエントロピーを持たせる。
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const auth = new Hono<{ Bindings: Env }>()

auth.get('/login', (c) => {
  const state = randomToken()
  const params = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID,
    redirect_uri: c.env.OAUTH_CALLBACK_URL,
    scope: 'repo',
    state,
  })
  setCookie(c, OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isProduction(c.env),
    maxAge: 600,
    path: '/',
  })
  return c.redirect(`${GITHUB_AUTHORIZE_URL}?${params.toString()}`)
})

auth.get('/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const storedState = getCookie(c, OAUTH_STATE_COOKIE)

  if (!code || !state || !storedState || storedState !== state) {
    throw new HTTPException(400, { message: 'Invalid OAuth state' })
  }

  // code → access_token
  const tokenResp = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: c.env.OAUTH_CALLBACK_URL,
    }),
  })
  if (!tokenResp.ok) {
    throw new HTTPException(500, { message: `GitHub token request failed: ${tokenResp.status}` })
  }
  const tokenData = (await tokenResp.json()) as any
  const accessToken = tokenData.access_token
  if (!accessToken) {
    const detail = tokenData.error_description ?? tokenData.error ?? JSON.stringify(tokenData)
    throw new HTTPException(500, { message: `GitHub token error: ${detail}` })
  }

  // ユーザー情報取得
  const userResp = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'quill-md-editor',
    },
  })
  if (!userResp.ok) {
    throw new HTTPException(500, { message: `GitHub user request failed: ${userResp.status}` })
  }
  const userData = (await userResp.json()) as any

  const sessionCookie = await createSession(
    {
      github_access_token: accessToken,
      github_login: userData.login,
      github_avatar_url: userData.avatar_url ?? '',
    },
    c.env.SESSION_SECRET_KEY,
  )

  deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/' })
  setCookie(c, SESSION_COOKIE, sessionCookie, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isProduction(c.env),
    maxAge: SESSION_TTL,
    path: '/',
  })
  return c.redirect(`${c.env.FRONTEND_ORIGIN}/`)
})

auth.get('/me', async (c) => {
  const session = await requireSession(c)
  return c.json({ login: session.github_login, avatar_url: session.github_avatar_url })
})

auth.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ message: 'logged out' })
})
