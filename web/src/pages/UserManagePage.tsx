import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import { allRoles, normalizeRoles, roleLabel, statusLabel, toggleRole, type RoleName } from '../lib/userRoles'
import type { UserProfile } from '../types'

type Props = {
  userId: number
}

function resolveBackPath(rawBack: string | null): string {
  if (!rawBack) {
    return '/users'
  }
  try {
    const decoded = decodeURIComponent(rawBack)
    if (decoded.startsWith('/users')) {
      return decoded
    }
    return '/users'
  } catch {
    return '/users'
  }
}

export function UserManagePage({ userId }: Props) {
  const toast = useToast()
  const navigate = useNavigate()
  const { targetUserId } = useParams<{ targetUserId: string }>()
  const [searchParams] = useSearchParams()
  const backPath = useMemo(() => resolveBackPath(searchParams.get('back')), [searchParams])
  const selectedId = useMemo(() => {
    const parsed = Number(targetUserId)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }, [targetUserId])

  const [managedUser, setManagedUser] = useState<UserProfile | null>(null)
  const [manageRoles, setManageRoles] = useState<RoleName[]>(['employee'])
  const [savingRoles, setSavingRoles] = useState(false)
  const [togglingStatus, setTogglingStatus] = useState(false)
  const [loading, setLoading] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordDraft, setPasswordDraft] = useState('')
  const [forceChange, setForceChange] = useState(true)

  const loadManagedUser = useCallback(async () => {
    if (selectedId === null) {
      return
    }
    setLoading(true)
    try {
      const users = await requestJson<UserProfile[]>('/users', { userId })
      const target = users.find((item) => item.id === selectedId) ?? null
      if (!target) {
        toast.error(`用户 #${selectedId} 不存在或无权限访问`)
        navigate(backPath, { replace: true })
        return
      }
      setManagedUser(target)
      setManageRoles(normalizeRoles(target.roles))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载用户失败')
    } finally {
      setLoading(false)
    }
  }, [backPath, navigate, selectedId, toast, userId])

  useEffect(() => {
    void loadManagedUser()
  }, [loadManagedUser])

  const saveRoles = async () => {
    if (!managedUser) {
      return
    }
    if (manageRoles.length === 0) {
      toast.error('至少保留一个角色')
      return
    }
    try {
      setSavingRoles(true)
      await requestJson(`/users/${managedUser.id}/roles`, {
        method: 'PUT',
        userId,
        body: { roles: manageRoles },
      })
      toast.success(`用户 #${managedUser.id} 角色已更新`)
      await loadManagedUser()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '角色更新失败')
    } finally {
      setSavingRoles(false)
    }
  }

  const toggleUserStatus = async () => {
    if (!managedUser) {
      return
    }
    const nextStatus = managedUser.status === 'enabled' ? 'disabled' : 'enabled'

    try {
      setTogglingStatus(true)
      await requestJson(`/users/${managedUser.id}/status`, {
        method: 'PUT',
        userId,
        body: { status: nextStatus },
      })
      toast.success(`用户 #${managedUser.id} 状态已更新为${statusLabel(nextStatus)}`)
      await loadManagedUser()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '状态更新失败')
    } finally {
      setTogglingStatus(false)
    }
  }

  const submitPasswordReset = async () => {
    if (!managedUser) {
      return
    }
    if (passwordDraft.length < 8) {
      toast.error('新密码至少 8 位')
      return
    }

    try {
      setSavingPassword(true)
      await requestJson(`/admin/users/${managedUser.id}/password`, {
        method: 'POST',
        userId,
        body: {
          new_password: passwordDraft,
          force_change: forceChange,
        },
      })
      toast.success(`用户 #${managedUser.id} 密码已重置`)
      setPasswordOpen(false)
      setPasswordDraft('')
      setForceChange(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '密码重置失败')
    } finally {
      setSavingPassword(false)
    }
  }

  if (selectedId === null) {
    return (
      <section className="page-wrap">
        <header className="page-head">
          <h2>用户管理</h2>
          <p>无效的用户 ID。</p>
        </header>
        <article className="panel">
          <div className="button-row">
            <button type="button" onClick={() => navigate(backPath)}>返回用户列表</button>
          </div>
        </article>
      </section>
    )
  }

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>用户管理 #{selectedId}</h2>
        <p>在独立页面维护角色、账号状态与密码重置。</p>
      </header>

      {loading || !managedUser ? (
        <article className="panel">
          <p>加载中...</p>
        </article>
      ) : (
        <>
          <article className="panel">
            <p className="line-metric">
              <span>用户</span>
              <strong>{managedUser.name}</strong>
            </p>
            <p className="line-metric">
              <span>当前状态</span>
              <strong>{statusLabel(managedUser.status)}</strong>
            </p>
            <p className="line-metric">
              <span>部门 / 邮箱</span>
              <strong>{managedUser.department ?? '-'} / {managedUser.email ?? '-'}</strong>
            </p>
          </article>

          <article className="panel">
            <h3>角色设置</h3>
            <div className="users-role-grid">
              {allRoles.map((role) => (
                <label className="users-role-item" key={`manage-role-${managedUser.id}-${role}`}>
                  <input
                    type="checkbox"
                    checked={manageRoles.includes(role)}
                    onChange={() => setManageRoles((prev) => toggleRole(prev, role))}
                  />
                  {roleLabel(role)}
                </label>
              ))}
            </div>
            <div className="button-row" style={{ marginTop: 12 }}>
              <button className="primary-btn" type="button" onClick={() => void saveRoles()} disabled={savingRoles}>
                {savingRoles ? '保存中...' : '保存角色'}
              </button>
              <button type="button" onClick={() => void toggleUserStatus()} disabled={togglingStatus}>
                {togglingStatus ? '处理中...' : managedUser.status === 'enabled' ? '禁用账号' : '启用账号'}
              </button>
            </div>
          </article>

          <article className="panel">
            <h3>密码重置</h3>
            {!passwordOpen ? (
              <button type="button" onClick={() => setPasswordOpen(true)}>
                打开重置面板
              </button>
            ) : (
              <div className="form-grid">
                <label className="wide">
                  新密码（至少 8 位）
                  <input
                    type="password"
                    value={passwordDraft}
                    onChange={(event) => setPasswordDraft(event.target.value)}
                    placeholder="请输入新密码"
                  />
                </label>
                <label className="wide">
                  <input
                    type="checkbox"
                    checked={forceChange}
                    onChange={(event) => setForceChange(event.target.checked)}
                  />
                  下次登录强制修改密码
                </label>
                <div className="button-row wide">
                  <button type="button" onClick={() => setPasswordOpen(false)} disabled={savingPassword}>
                    取消
                  </button>
                  <button className="primary-btn" type="button" onClick={() => void submitPasswordReset()} disabled={savingPassword}>
                    {savingPassword ? '提交中...' : '确认重置'}
                  </button>
                </div>
              </div>
            )}
          </article>
        </>
      )}

      <article className="panel">
        <div className="button-row">
          <button type="button" onClick={() => navigate(backPath)} disabled={savingRoles || savingPassword || togglingStatus}>
            返回用户列表
          </button>
          <button type="button" onClick={() => void loadManagedUser()} disabled={loading || savingRoles || savingPassword || togglingStatus}>
            刷新
          </button>
        </div>
      </article>
    </section>
  )
}
