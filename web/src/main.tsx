import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'

import App from './App'
import { requestJson } from './lib/http'
import type { UserProfile } from './types'
import './index.css'

const userIdStorageKey = 'bw_current_user_id'

function Bootstrap() {
  const [userId, setUserId] = useState<number>(() => {
    const cached = localStorage.getItem(userIdStorageKey)
    return cached ? Number(cached) || 1 : 1
  })
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem(userIdStorageKey, String(userId))
  }, [userId])

  useEffect(() => {
    const loadProfile = async () => {
      setLoadingProfile(true)
      try {
        const data = await requestJson<UserProfile>('/me', { userId })
        setProfile(data)
        setProfileError(null)
      } catch (err) {
        setProfile(null)
        setProfileError(err instanceof Error ? err.message : '读取用户失败')
      } finally {
        setLoadingProfile(false)
      }
    }
    void loadProfile()
  }, [userId])

  return (
    <HashRouter>
      <App
        userId={userId}
        setUserId={setUserId}
        profile={profile}
        loadingProfile={loadingProfile}
        profileError={profileError}
      />
    </HashRouter>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Bootstrap />
  </StrictMode>,
)

