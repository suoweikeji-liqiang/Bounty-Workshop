import { useState } from 'react'
import type { FormEvent } from 'react'

import { requestJson } from '../lib/http'
import type { AuthLoginResponse } from '../types'

type Props = {
  onLogin: (payload: AuthLoginResponse) => void
}

export function LoginPage({ onLogin }: Props) {
  const [employeeNo, setEmployeeNo] = useState('A0001')
  const [userId, setUserId] = useState('1')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      setLoading(true)
      setError(null)
      const parsedId = Number(userId)
      const body = Number.isInteger(parsedId) && parsedId > 0
        ? { user_id: parsedId }
        : { employee_no: employeeNo.trim() }
      const payload = await requestJson<AuthLoginResponse>('/auth/login', {
        method: 'POST',
        body,
      })
      onLogin(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'login failed')
    } finally {
      setLoading(false)
    }
  }

  const loginByFeishu = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await requestJson<{ login_url: string }>('/auth/feishu/login-url', {
        method: 'GET',
      })
      window.location.href = data.login_url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'feishu login init failed')
      setLoading(false)
    }
  }

  return (
    <section className="login-wrap">
      <article className="login-card">
        <p className="kicker">Bounty Workshop</p>
        <h1>Sign In</h1>
        <p className="muted">Use token-based session. Legacy X-User-Id switch is no longer required on UI.</p>
        <form className="form-grid" onSubmit={submit}>
          <label>
            User ID (preferred in dev)
            <input
              type="number"
              min={1}
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="e.g. 1"
            />
          </label>
          <label>
            Employee No (fallback)
            <input
              value={employeeNo}
              onChange={(event) => setEmployeeNo(event.target.value)}
              placeholder="e.g. A0001"
            />
          </label>
          <button className="primary-btn" type="submit" disabled={loading}>
            {loading ? 'signing in...' : 'sign in'}
          </button>
          <button type="button" onClick={() => void loginByFeishu()} disabled={loading}>
            sign in with feishu
          </button>
        </form>
        {error && <p className="error-text">{error}</p>}
      </article>
    </section>
  )
}
