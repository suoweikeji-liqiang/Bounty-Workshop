import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { useToast } from '../components/ToastProvider'
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

type FeishuSection = 'oauth' | 'sync' | 'scheduler' | 'departments'

export function FeishuPage({ userId, profile }: Props) {
  const toast = useToast()
  const [activeSection, setActiveSection] = useState<FeishuSection>('oauth')
  const [code, setCode] = useState('')
  const [state, setState] = useState('')
  const [loginUrl, setLoginUrl] = useState<LoginUrl | null>(null)
  const [loginResult, setLoginResult] = useState<LoginResult | null>(null)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [frequency, setFrequency] = useState(60)
  const [frequencyDraft, setFrequencyDraft] = useState('60')
  const [releaseFrequency, setReleaseFrequency] = useState(1440)
  const [releaseFrequencyDraft, setReleaseFrequencyDraft] = useState('1440')
  const [confirmReleaseOpen, setConfirmReleaseOpen] = useState(false)
  const [syncingMode, setSyncingMode] = useState<'all' | 'users' | 'departments' | null>(null)
  const [runningReleaseNow, setRunningReleaseNow] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canAdmin = Boolean(profile?.roles.includes('admin'))
  const hasFreqChanges = String(frequency) !== frequencyDraft.trim()
  const hasReleaseFreqChanges = String(releaseFrequency) !== releaseFrequencyDraft.trim()

  const sectionButtons = useMemo(
    () => [
      { id: 'oauth' as const, label: 'OAuth 登录' },
      { id: 'sync' as const, label: '通讯录同步' },
      { id: 'scheduler' as const, label: '定时任务' },
      { id: 'departments' as const, label: `部门列表 (${departments.length})` },
    ],
    [departments.length],
  )

  const loadDepartments = useCallback(async () => {
    try {
      const res = await requestJson<Department[]>('/departments', { userId })
      setDepartments(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载部门失败')
    }
  }, [userId])

  const loadFrequency = useCallback(async () => {
    if (!canAdmin) {
      return
    }
    try {
      const [feishu, release] = await Promise.all([
        requestJson<{ frequency_minutes: number }>('/system/config/feishu-sync-frequency', { userId }),
        requestJson<{ frequency_minutes: number }>('/system/config/release-overdue-frequency', { userId }),
      ])
      setFrequency(feishu.frequency_minutes)
      setFrequencyDraft(String(feishu.frequency_minutes))
      setReleaseFrequency(release.frequency_minutes)
      setReleaseFrequencyDraft(String(release.frequency_minutes))
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取频率失败')
    }
  }, [canAdmin, userId])

  const saveReleaseFrequency = async () => {
    const next = Number(releaseFrequencyDraft)
    if (!Number.isInteger(next) || next < 5 || next > 10080) {
      setError('超期检查频率范围应为 5-10080 分钟')
      return
    }
    try {
      setError(null)
      await requestJson('/system/config/release-overdue-frequency', {
        method: 'PUT',
        userId,
        body: { frequency_minutes: next },
      })
      setReleaseFrequency(next)
      setReleaseFrequencyDraft(String(next))
      setMessage('超期检查频率已更新')
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败')
    }
  }

  const saveFrequency = async () => {
    const next = Number(frequencyDraft)
    if (!Number.isInteger(next) || next < 5 || next > 10080) {
      setError('同步频率范围应为 5-10080 分钟')
      return
    }
    try {
      setError(null)
      await requestJson('/system/config/feishu-sync-frequency', {
        method: 'PUT',
        userId,
        body: { frequency_minutes: next },
      })
      setFrequency(next)
      setFrequencyDraft(String(next))
      setMessage('同步频率已更新')
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败')
    }
  }

  const releaseOverdueNow = async () => {
    if (!canAdmin) {
      return
    }
    try {
      setRunningReleaseNow(true)
      setError(null)
      const res = await requestJson<{ released_claims: number }>('/jobs/release-overdue', {
        method: 'POST',
        userId,
      })
      setMessage(`已执行超期释放，本次释放 ${res.released_claims} 条`)
      setConfirmReleaseOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '执行超期释放失败')
    } finally {
      setRunningReleaseNow(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDepartments()
      void loadFrequency()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadDepartments, loadFrequency])

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
    const trimmedCode = code.trim()
    if (!trimmedCode) {
      setError('请输入授权码 code')
      return
    }
    try {
      setError(null)
      const query = new URLSearchParams()
      query.set('code', trimmedCode)
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
      setSyncingMode(mode)
      const res = await requestJson<SyncResult>(`/integrations/feishu/sync?mode=${mode}`, {
        method: 'POST',
        userId,
      })
      setSyncResult(res)
      await loadDepartments()
      setMessage(`同步完成：部门 ${res.synced_departments}，人员 ${res.synced_users}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步失败')
    } finally {
      setSyncingMode(null)
    }
  }

  useEffect(() => {
    if (!message) {
      return
    }
    toast.success(message)
  }, [message, toast])

  useEffect(() => {
    if (!error) {
      return
    }
    toast.error(error)
  }, [error, toast])

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>飞书集成</h2>
        <p>OAuth 回调、通讯录同步和定时频率设置。</p>
      </header>

      <article className="panel">
        <div className="button-row">
          {sectionButtons.map((item) => (
            <button
              key={item.id}
              type="button"
              className={activeSection === item.id ? 'primary-btn' : ''}
              onClick={() => setActiveSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </article>

      {activeSection === 'oauth' && (
        <article className="panel form-grid">
          <div className="panel-headline wide">
            <h3>OAuth 登录</h3>
            <button type="button" onClick={() => void generateLoginUrl()}>
              生成登录链接
            </button>
          </div>
          {loginUrl && (
            <p className="wide muted">
              <a href={loginUrl.login_url} target="_blank" rel="noreferrer">
                打开授权页（{loginUrl.provider}）
              </a>
            </p>
          )}
          <form className="wide form-grid" onSubmit={callbackLogin}>
            <label>
              授权码（code）
              <input value={code} onChange={(event) => setCode(event.target.value)} required />
            </label>
            <label>
              状态参数（state）
              <input value={state} onChange={(event) => setState(event.target.value)} />
            </label>
            <div className="button-row wide">
              <button className="primary-btn" type="submit">
                调用回调登录
              </button>
            </div>
          </form>
          {loginResult && (
            <p className="line-metric wide">
              <span>{loginResult.user_name}</span>
              <strong>{loginResult.is_new_user ? '新用户' : '已存在用户'}</strong>
            </p>
          )}
        </article>
      )}

      {activeSection === 'sync' && (
        <article className="panel">
          <h3>通讯录同步</h3>
          {canAdmin ? (
            <div className="button-row">
              <button type="button" onClick={() => void sync('all')} disabled={syncingMode !== null}>
                {syncingMode === 'all' ? '同步中...' : '同步全部'}
              </button>
              <button type="button" onClick={() => void sync('departments')} disabled={syncingMode !== null}>
                {syncingMode === 'departments' ? '同步中...' : '仅同步部门'}
              </button>
              <button type="button" onClick={() => void sync('users')} disabled={syncingMode !== null}>
                {syncingMode === 'users' ? '同步中...' : '仅同步人员'}
              </button>
            </div>
          ) : (
            <p className="muted">当前账号非管理员，仅可查看同步结果。</p>
          )}
          {syncResult && (
            <p className="line-metric">
              <span>最近一次同步结果</span>
              <strong>
                部门 {syncResult.synced_departments} / 人员 {syncResult.synced_users} / 模式 {syncResult.mode}
              </strong>
            </p>
          )}
        </article>
      )}

      {activeSection === 'scheduler' && (
        <article className="panel form-grid">
          <h3 className="wide">定时任务</h3>
          {!canAdmin ? (
            <p className="muted wide">当前账号非管理员。仅管理员可修改频率与执行后台任务。</p>
          ) : (
            <>
              <label>
                飞书同步频率（分钟）
                <input
                  type="number"
                  min={5}
                  max={10080}
                  value={frequencyDraft}
                  onChange={(event) => setFrequencyDraft(event.target.value)}
                />
              </label>
              <div className="button-row" style={{ alignItems: 'end' }}>
                <button className="primary-btn" type="button" onClick={() => void saveFrequency()} disabled={!hasFreqChanges}>
                  保存同步频率
                </button>
                <span className="muted">当前：{frequency} 分钟</span>
              </div>

              <label>
                超期释放频率（分钟）
                <input
                  type="number"
                  min={5}
                  max={10080}
                  value={releaseFrequencyDraft}
                  onChange={(event) => setReleaseFrequencyDraft(event.target.value)}
                />
              </label>
              <div className="button-row" style={{ alignItems: 'end' }}>
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => void saveReleaseFrequency()}
                  disabled={!hasReleaseFreqChanges}
                >
                  保存超期频率
                </button>
                <button type="button" onClick={() => setConfirmReleaseOpen(true)}>
                  立即执行超期释放
                </button>
                <span className="muted">当前：{releaseFrequency} 分钟</span>
              </div>
            </>
          )}
        </article>
      )}

      {activeSection === 'departments' && (
        <article className="panel">
          <div className="panel-headline">
            <h3>部门列表</h3>
            <button type="button" onClick={() => void loadDepartments()}>
              刷新
            </button>
          </div>
          <div className="table">
            <div className="row head">
              <span>ID</span>
              <span>外部 ID</span>
              <span>名称</span>
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
            {departments.length === 0 && (
              <div className="row">
                <span style={{ gridColumn: '1 / -1', textAlign: 'center' }}>暂无部门数据，请先执行同步</span>
              </div>
            )}
          </div>
        </article>
      )}

      {confirmReleaseOpen && (
        <div className="modal-backdrop" onClick={() => setConfirmReleaseOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="confirm-release-title">
            <div className="panel-headline">
              <h3 id="confirm-release-title">确认执行超期释放</h3>
              <button type="button" onClick={() => setConfirmReleaseOpen(false)} disabled={runningReleaseNow}>
                关闭
              </button>
            </div>
            <p>该操作会扫描并释放超期未提交进展的揭榜记录，请确认后继续。</p>
            <div className="button-row">
              <button type="button" onClick={() => setConfirmReleaseOpen(false)} disabled={runningReleaseNow}>
                取消
              </button>
              <button className="primary-btn" type="button" onClick={() => void releaseOverdueNow()} disabled={runningReleaseNow}>
                {runningReleaseNow ? '执行中...' : '确认执行'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
