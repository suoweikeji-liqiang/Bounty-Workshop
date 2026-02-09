import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { AuthLoginResponse } from '../types'

type Props = {
  onLogin: (payload: AuthLoginResponse) => void
}

export function LoginPage({ onLogin }: Props) {
  const toast = useToast()
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
      setError(err instanceof Error ? err.message : '登录失败')
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
      setError(err instanceof Error ? err.message : '飞书登录初始化失败')
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!error) {
      return
    }
    toast.error(error)
  }, [error, toast])

  return (
    <section className="login-wrap">
      <article className="login-card">
        <p className="kicker">揭榜挂帅工坊</p>
        <h1>登录</h1>
        <p className="muted">系统使用 Token 会话认证，前端无需再手动切换 X-User-Id。</p>
        <form className="form-grid" onSubmit={submit}>
          <label>
            用户 ID（开发环境优先）
            <input
              type="number"
              min={1}
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="例如：1"
            />
          </label>
          <label>
            工号（备用）
            <input
              value={employeeNo}
              onChange={(event) => setEmployeeNo(event.target.value)}
              placeholder="例如：A0001"
            />
          </label>
          <button className="primary-btn" type="submit" disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </button>
          <button type="button" onClick={() => void loginByFeishu()} disabled={loading}>
            使用飞书登录
          </button>
        </form>
      </article>
    </section>
  )
}
