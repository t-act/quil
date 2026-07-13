export interface Env {
  // Static Assets バインディング（quill/dist）。SPA フォールバックのために Worker から明示的に呼ぶ。
  ASSETS: Fetcher
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  SESSION_SECRET_KEY: string
  OAUTH_CALLBACK_URL: string
  FRONTEND_ORIGIN: string
  ENV: string
}
