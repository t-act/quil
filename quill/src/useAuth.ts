import { useEffect, useState } from 'react'
import { AuthError, UserResponse, fetchMe, logout as apiLogout } from './api'

type AuthState = {
  user: UserResponse | null
  loading: boolean
}

export function useAuth(): AuthState & { logout: () => Promise<void> } {
  const [user, setUser] = useState<UserResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchMe()
      .then(setUser)
      .catch((err) => {
        if (err instanceof AuthError) {
          setUser(null)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  const logout = async () => {
    await apiLogout().catch(() => {})
    window.location.reload()
  }

  return { user, loading, logout }
}
