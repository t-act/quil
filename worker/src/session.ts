import { getCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import type { Context } from 'hono'

export const SESSION_COOKIE = 'md_editor_session'
export const OAUTH_STATE_COOKIE = 'oauth_state'
export const SESSION_TTL = 8 * 60 * 60 // 8時間（秒）

export interface SessionData {
  github_access_token: string
  github_login: string
  github_avatar_url: string
}

// btoa/atob はバイナリ文字列しか扱えないため、Uint8Array を経由して base64url に変換する。
// Cookie 値に載せるので、パディングと + / を含まない base64url を採用している。
function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(value: string): Uint8Array {
  // 標準 base64（+ / =）で渡ってきても解釈できるよう、先に base64url へ寄せてから復元する。
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  const bin = atob(normalized + pad)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function importKey(secret: string): Promise<CryptoKey> {
  const keyBytes = base64UrlDecode(secret)
  if (keyBytes.length !== 32) {
    // AES-256-GCM は 32 バイト鍵が前提。長さ不一致は設定ミスなので握り潰さず即エラーにする。
    throw new Error('SESSION_SECRET_KEY must be a base64-encoded 32-byte key')
  }
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function createSession(data: SessionData, secret: string): Promise<string> {
  const key = await importKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const payload = JSON.stringify({
    github_access_token: data.github_access_token,
    github_login: data.github_login,
    github_avatar_url: data.github_avatar_url,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL,
  })
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(payload)),
  )
  // iv を先頭に連結して 1 本のトークンにする（DB を持たないため復号に必要な iv も自己完結させる）。
  const packed = new Uint8Array(iv.length + ciphertext.length)
  packed.set(iv, 0)
  packed.set(ciphertext, iv.length)
  return base64UrlEncode(packed)
}

export async function decodeSession(cookie: string, secret: string): Promise<SessionData | null> {
  try {
    const key = await importKey(secret)
    const packed = base64UrlDecode(cookie)
    const iv = packed.slice(0, 12)
    const ciphertext = packed.slice(12)
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
    const data = JSON.parse(new TextDecoder().decode(plaintext))
    if (typeof data.exp !== 'number' || data.exp < Math.floor(Date.now() / 1000)) {
      return null
    }
    return {
      github_access_token: data.github_access_token,
      github_login: data.github_login,
      github_avatar_url: data.github_avatar_url,
    }
  } catch {
    // 復号失敗・改ざん・期限切れはすべて「無効なセッション」として扱い、詳細は漏らさない。
    return null
  }
}

export async function requireSession(c: Context): Promise<SessionData> {
  const cookie = getCookie(c, SESSION_COOKIE)
  if (!cookie) {
    throw new HTTPException(401, { message: 'Not authenticated' })
  }
  const session = await decodeSession(cookie, c.env.SESSION_SECRET_KEY)
  if (!session) {
    throw new HTTPException(401, { message: 'Session expired or invalid' })
  }
  return session
}
