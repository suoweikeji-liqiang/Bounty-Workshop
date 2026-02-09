import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { requestJson } from '../lib/http'
import type { Department, UserProfile } from '../types'

type Props = {
  userId: number
  profile: UserProfile | null
}

type LoginUrl = {
  provider: string
  state: string
  login_url: string
  expires_at: string
}

type LoginResult = {
  user_id: number
  user_name: string
  external_id: string
  is_new_user: boolean
}

type SyncResult = {
  synced_departments: number
  synced_users: number
  mode: string
}

export function FeishuPage({ userId, profile }: Props) {
  const [code, setCode] = useState('')
  const [state, setState] = useState('')
  const [loginUrl, setLoginUrl] = useState<LoginUrl | null>(null)
  const [loginResult, setLoginResult] = useState<LoginResult | null>(null)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [frequency, setFrequency] = useState(60)
  const [releaseFrequency, setReleaseFrequency] = useState(1440)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canAdmin = Boolean(profile?.roles.includes('admin'))

  const loadDepartments = useCallback(async () => {
    try {
      const res = await requestJson<Department[]>('/departments', { userId })
      setDepartments(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载部门失败')
    }
  }, [userId])

  const loadFrequency = useCallback(async () => {
    try {
      const [feishu, release] = await Promise.all([
        requestJson<{ frequency_minutes: number }>('/system/config/feishu-sync-frequency', {
          userId,
        }),
        requestJson<{ frequency_minutes: number }>('/system/config/release-overdue-frequency', {
          userId,
        }),
      ])
      setFrequency(feishu.frequency_minutes)
      setReleaseFrequency(release.frequency_minutes)
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取频率失败')
    }
  }, [userId])

  const saveReleaseFrequency = async () => {
    try {
      setError(null)
      await requestJson('/system/config/release-overdue-frequency', {
        method: 'PUT',
        userId,
        body: { frequency_minutes: releaseFrequency },
      })
      setMessage('超期检查频率已更新')
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败')
    }
  }

  const saveFrequency = async () => {
    try {
      setError(null)
      await requestJson('/system/config/feishu-sync-frequency', {
        method: 'PUT',
        userId,
        body: { frequency_minutes: frequency },
      })
      setMessage('同步频率已更新')
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败')
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDepartments()
      if (canAdmin) {
        void loadFrequency()
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [canAdmin, loadDepartments, loadFrequency])

  const generateLoginUrl = async () => {
    try {
      setError(null)
      const res = await requestJson<LoginUrl>('/auth/feishu/login-url', { userId })
      setLoginUrl(res)
      setState(res.state)
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成登录链接失败')
    }
  }

  const callbackLogin = async (event: FormEvent) => {
    event.preventDefault()
    try {
      setError(null)
      const query = new URLSearchParams()
      query.set('code', code)
      if (state.trim()) {
        query.set('state', state.trim())
      }
      const res = await requestJson<LoginResult>(`/auth/feishu/callback?${query.toString()}`, { userId })
      setLoginResult(res)
      setMessage(`登录成功：${res.user_name} (id=${res.user_id})`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    }
  }

  const sync = async (mode: 'all' | 'users' | 'departments') => {
    try {
      setError(null)
      const res = await requestJson<SyncResult>(`/integrations/feishu/sync?mode=${mode}`, {
        method: 'POST',
        userId,
      })
      setSyncResult(res)
      await loadDepartments()
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步失败')
    }
  }

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>飞书集成</h2>
        <p>OAuth 回调、通讯录同步与频率配置。</p>
      </header>
      {message && <p className="ok-text">{message}</p>}
      {error && <p className="error-text">{error}</p>}
      <article className="panel form-grid">
        <h3>OAuth 登录</h3>
        <button type="button" onClick={() => void generateLoginUrl()}>
          生成登录链接
        </button>
        {loginUrl && (
          <p className="muted">
            <a href={loginUrl.login_url} target="_blank" rel="noreferrer">
              打开授权页（{loginUrl.provider}）
            </a>
          </p>
        )}
        <form className="nested-form" onSubmit={callbackLogin}>
          <label>
            code
            <input value={code} onChange={(event) => setCode(event.target.value)} required />
          </label>
          <label>
            state
            <input value={state} onChange={(event) => setState(event.target.value)} />
          </label>
          <button className="primary-btn" type="submit">
            调用回调登录
          </button>
        </form>
        {loginResult && (
          <p className="line-metric">
            <span>{loginResult.user_name}</span>
            <strong>{loginResult.is_new_user ? '新用户' : '已存在用户'}</strong>
          </p>
        )}
      </article>
      <article className="panel">
        <h3>通讯录同步</h3>
        {canAdmin ? (
          <div className="button-row">
            <button type="button" onClick={() => void sync('all')}>
              同步全部
            </button>
            <button type="button" onClick={() => void sync('departments')}>
              仅同步部门
            </button>
            <button type="button" onClick={() => void sync('users')}>
              仅同步人员
            </button>
          </div>
        ) : (
          <p className="muted">当前账号非管理员，仅可查看同步结果。</p>
        )}
        {syncResult && (
          <p className="line-metric">
            <span>结果</span>
            <strong>
              部门 {syncResult.synced_departments} / 人员 {syncResult.synced_users}
            </strong>
          </p>
        )}
      </article>
      {canAdmin && (
        <>
          <article className="panel form-grid">
            <h3>飞书同步频率（分钟）</h3>
            <label>
              frequency_minutes
              <input
                type="number"
                min={5}
                max={10080}
                value={frequency}
                onChange={(event) => setFrequency(Number(event.target.value))}
              />
            </label>
            <button type="button" onClick={() => void saveFrequency()}>
              保存频率
            </button>
          </article>
          <article className="panel form-grid">
            <h3>超期任务检查频率（分钟）</h3>
            <label>
              frequency_minutes
              <input
                type="number"
                min={5}
                max={10080}
                value={releaseFrequency}
                onChange={(event) => setReleaseFrequency(Number(event.target.value))}
              />
            </label>
            <button type="button" onClick={() => void saveReleaseFrequency()}>
              保存频率
            </button>
          </article>
        </>
      )}
      <article className="panel">
        <h3>部门列表</h3>
        <div className="table">
          <div className="row head">
            <span>ID</span>
            <span>external_id</span>
            <span>name</span>
            <span>更新时间</span>
          </div>
          {departments.map((dept) => (
            <div className="row" key={dept.id}>
              <span>{dept.id}</span>
              <span>{dept.external_id}</span>
              <span>{dept.name}</span>
              <span>{new Date(dept.updated_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </article>
    </section>
  )
}
