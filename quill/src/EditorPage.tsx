import { useEffect, useMemo, useState } from 'react'
import MDEditor from '@uiw/react-md-editor'
import {
  AuthError,
  RepoInfo,
  UserResponse,
  commitFile,
  fetchFile,
  fetchFiles,
  fetchRepos,
} from './api'

type Status = { type: 'idle' | 'success' | 'error'; message: string }

type Props = {
  user: UserResponse
  onAuthError: () => void
  logout: () => Promise<void>
}

export default function EditorPage({ user, onAuthError, logout }: Props) {
  const [repos, setRepos] = useState<RepoInfo[]>([])
  const [selectedRepo, setSelectedRepo] = useState<RepoInfo | null>(null)
  const [files, setFiles] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [commitMessage, setCommitMessage] = useState<string>('')
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [loadingFile, setLoadingFile] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [status, setStatus] = useState<Status>({ type: 'idle', message: '' })

  const handleAuthError = (err: unknown) => {
    if (err instanceof AuthError) {
      onAuthError()
      return true
    }
    return false
  }

  // リポジトリ一覧を取得
  useEffect(() => {
    const load = async () => {
      setLoadingRepos(true)
      try {
        const data = await fetchRepos()
        setRepos(data.repos)
        if (data.repos.length > 0) setSelectedRepo(data.repos[0])
      } catch (err) {
        if (!handleAuthError(err)) {
          setStatus({ type: 'error', message: `リポジトリ一覧の取得に失敗しました: ${String(err)}` })
        }
      } finally {
        setLoadingRepos(false)
      }
    }
    load()
  }, [])

  // リポジトリ選択時にファイル一覧を取得
  useEffect(() => {
    if (!selectedRepo) return
    setFiles([])
    setSelected(null)
    setContent('')
    const load = async () => {
      setLoadingFiles(true)
      setStatus({ type: 'idle', message: '' })
      try {
        const data = await fetchFiles(selectedRepo.owner, selectedRepo.name, selectedRepo.default_branch)
        setFiles(data.files)
        if (data.files.length > 0) setSelected(data.files[0])
      } catch (err) {
        if (!handleAuthError(err)) {
          setStatus({ type: 'error', message: `ファイル一覧の取得に失敗しました: ${String(err)}` })
        }
      } finally {
        setLoadingFiles(false)
      }
    }
    load()
  }, [selectedRepo])

  // ファイル選択時にファイル内容を取得
  useEffect(() => {
    if (!selected || !selectedRepo) return
    const load = async () => {
      setLoadingFile(true)
      setStatus({ type: 'idle', message: '' })
      try {
        const data = await fetchFile(selectedRepo.owner, selectedRepo.name, selected, selectedRepo.default_branch)
        setContent(data.content)
      } catch (err) {
        if (!handleAuthError(err)) {
          setStatus({ type: 'error', message: `ファイルの読み込みに失敗しました: ${String(err)}` })
        }
      } finally {
        setLoadingFile(false)
      }
    }
    load()
  }, [selected])

  const canCommit = useMemo(
    () => !!selected && !!selectedRepo && !loadingFile && !committing,
    [selected, selectedRepo, loadingFile, committing],
  )

  const handleCommit = async () => {
    if (!selected || !selectedRepo) return
    setCommitting(true)
    setStatus({ type: 'idle', message: '' })
    try {
      await commitFile(
        selectedRepo.owner,
        selectedRepo.name,
        selectedRepo.default_branch,
        selected,
        content,
        commitMessage.trim(),
      )
      setStatus({ type: 'success', message: 'コミットしました。GitHubで反映を確認してください。' })
      setCommitMessage('')
    } catch (err) {
      if (!handleAuthError(err)) {
        setStatus({ type: 'error', message: `コミットに失敗しました: ${String(err)}` })
      }
    } finally {
      setCommitting(false)
    }
  }

  return (
    <div className="app" data-color-mode="light">
      <header className="hero">
        <div>
          <p className="eyebrow">Markdown Editor → GitHub Commit</p>
          <h1>モバイルでもサクッと編集</h1>
          <p className="subhead">GitHub上のMarkdownを読み込み、編集し、そのままコミット。</p>
        </div>
        <div className="header-right">
          <div className="status-panel">
            <h2>ステータス</h2>
            {status.message ? (
              <div className={`status ${status.type}`}>{status.message}</div>
            ) : (
              <div className="status idle">準備OK</div>
            )}
          </div>
          <div className="user-info">
            <img src={user.avatar_url} alt={user.login} className="avatar" />
            <span className="username">{user.login}</span>
            <button className="logout-button" onClick={logout}>ログアウト</button>
          </div>
        </div>
      </header>

      <div className="repo-bar">
        <label htmlFor="repo-select">リポジトリ：</label>
        {loadingRepos ? (
          <span className="pill">Loading...</span>
        ) : (
          <select
            id="repo-select"
            value={selectedRepo?.full_name ?? ''}
            onChange={(e) => {
              const repo = repos.find((r) => r.full_name === e.target.value)
              if (repo) setSelectedRepo(repo)
            }}
          >
            {repos.map((r) => (
              <option key={r.full_name} value={r.full_name}>
                {r.full_name}{r.private ? ' 🔒' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      <main className="layout">
        <section className="panel file-panel">
          <div className="panel-header">
            <h2>ファイル一覧</h2>
            {loadingFiles && <span className="pill">Loading...</span>}
          </div>
          <div className="file-list">
            {files.length === 0 && !loadingFiles ? (
              <p className="muted">Markdownファイルが見つかりません。</p>
            ) : (
              files.map((file) => (
                <button
                  key={file}
                  className={`file-item ${file === selected ? 'active' : ''}`}
                  onClick={() => setSelected(file)}
                >
                  {file}
                </button>
              ))
            )}
          </div>
        </section>

        <section className="panel editor-panel">
          <div className="panel-header">
            <h2>エディタ</h2>
            {loadingFile && <span className="pill">Loading...</span>}
          </div>
          <div className="editor-wrapper">
            <MDEditor value={content} onChange={(val) => setContent(val ?? '')} height={420} />
          </div>
          <div className="commit-bar">
            <input
              className="commit-input"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder={selected ? `Update ${selected}` : 'Commit message'}
            />
            <button className="commit-button" onClick={handleCommit} disabled={!canCommit}>
              {committing ? 'Committing...' : 'Commit'}
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}
