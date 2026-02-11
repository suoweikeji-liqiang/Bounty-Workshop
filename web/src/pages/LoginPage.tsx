import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { AuthLoginResponse } from '../types'

type Props = {
  onLogin: (payload: AuthLoginResponse) => void
}

type LoginMode = 'feishu' | 'admin'

export function LoginPage({ onLogin }: Props) {
  const toast = useToast()
  const [mode, setMode] = useState<LoginMode>('feishu')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submitAdminLogin = async (event: FormEvent) => {
    event.preventDefault()
    try {
      setLoading(true)
      setError(null)
      const payload = await requestJson<AuthLoginResponse>('/auth/admin/login', {
        method: 'POST',
        body: { username: username.trim(), password },
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
        
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button
            type="button"
            className={mode === 'feishu' ? 'primary-btn' : 'ghost-btn'}
            onClick={() => setMode('feishu')}
            style={{ flex: 1 }}
          >
            员工登录
          </button>
          <button
            type="button"
            className={mode === 'admin' ? 'primary-btn' : 'ghost-btn'}
            onClick={() => setMode('admin')}
            style={{ flex: 1 }}
          >
            管理员登录
          </button>
        </div>

        {mode === 'feishu' ? (
          <div>
            <p className="muted">
              点击下方按钮使用飞书账号登录，首次登录将自动创建账号。
            </p>
            <button 
              className="primary-btn" 
              type="button" 
              onClick={() => void loginByFeishu()} 
              disabled={loading}
              style={{ width: '100%' }}
            >
              {loading ? '跳转中...' : '使用飞书登录'}
            </button>
          </div>
        ) : (
          <form className="form-grid" onSubmit={submitAdminLogin}>
            <p className="muted">
              仅限管理员使用账号密码登录。
            </p>
            <label className="wide">
              用户名
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="工号或邮箱"
                required
              />
            </label>
            <label className="wide">
              密码
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                required
                minLength={6}
              />
            </label>
            <button className="primary-btn wide" type="submit" disabled={loading}>
              {loading ? '登录中...' : '登录'}
            </button>
          </form>
        )}
      </article>
    </section>
  )
}
