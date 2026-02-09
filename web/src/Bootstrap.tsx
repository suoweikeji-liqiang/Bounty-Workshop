import { useEffect, useMemo, useState } from 'react'
import { HashRouter } from 'react-router-dom'

import App from './App'
import { getStoredAuthToken, requestJson, setStoredAuthToken } from './lib/http'
import { LoginPage } from './pages/LoginPage'
import type { AuthLoginResponse, UserProfile } from './types'

type FeishuCallbackPayload = {
  user_id: number
  access_token?: string | null
}

export default function Bootstrap() {
  const [authToken, setAuthToken] = useState<string | null>(() => getStoredAuthToken())
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const userId = useMemo(() => profile?.id ?? 0, [profile])

  useEffect(() => {
    const initFromFeishuCallback = async () => {
      const search = new URLSearchParams(window.location.search)
      const code = search.get('code')
      if (!code) {
        return
      }

      const state = search.get('state')
      const query = new URLSearchParams({ code })
      if (state) {
        query.set('state', state)
      }

      try {
        setLoadingProfile(true)
        const payload = await requestJson<FeishuCallbackPayload>(`/auth/feishu/callback?${query.toString()}`, {
          method: 'GET',
        })
        if (payload.access_token) {
          setStoredAuthToken(payload.access_token)
          setAuthToken(payload.access_token)
        }
      } catch (err) {
        setProfileError(err instanceof Error ? err.message : 'feishu login callback failed')
      } finally {
        window.history.replaceState({}, document.title, window.location.pathname + window.location.hash)
        setLoadingProfile(false)
      }
    }

    void initFromFeishuCallback()
  }, [])

  useEffect(() => {
    const loadProfile = async () => {
      if (!authToken) {
        setProfile(null)
        return
      }

      setLoadingProfile(true)
      try {
        const data = await requestJson<UserProfile>('/me', { token: authToken })
        setProfile(data)
        setProfileError(null)
      } catch (err) {
        setProfile(null)
        setStoredAuthToken(null)
        setAuthToken(null)
        setProfileError(err instanceof Error ? err.message : 'failed to load user profile')
      } finally {
        setLoadingProfile(false)
      }
    }
    void loadProfile()
  }, [authToken])

  const handleLogin = (payload: AuthLoginResponse) => {
    setStoredAuthToken(payload.access_token)
    setAuthToken(payload.access_token)
    setProfile(payload.user)
    setProfileError(null)
  }

  const handleLogout = () => {
    setStoredAuthToken(null)
    setAuthToken(null)
    setProfile(null)
    setProfileError(null)
  }

  if (!authToken || !profile) {
    return <LoginPage onLogin={handleLogin} />
  }

  return (
    <HashRouter>
      <App
        userId={userId}
        profile={profile}
        loadingProfile={loadingProfile}
        profileError={profileError}
        onLogout={handleLogout}
      />
    </HashRouter>
  )
}
