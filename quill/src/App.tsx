import { useAuth } from './useAuth'
import LoginPage from './LoginPage'
import EditorPage from './EditorPage'

export default function App() {
  const { user, loading, logout } = useAuth()

  if (loading) {
    return (
      <div className="loading-screen">
        <span>Loading...</span>
      </div>
    )
  }

  if (!user) {
    return <LoginPage />
  }

  const handleAuthError = () => {
    window.location.reload()
  }

  return <EditorPage user={user} onAuthError={handleAuthError} logout={logout} />
}
