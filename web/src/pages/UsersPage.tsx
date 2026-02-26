import { useCallback, useEffect, useMemo, useState } from 'react'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { UserProfile } from '../types'

type Props = {
  userId: number
}

type RoleName = 'admin' | 'reviewer' | 'reward_approver' | 'acceptor' | 'employee'

const allRoles: RoleName[] = ['admin', 'reviewer', 'reward_approver', 'acceptor', 'employee']

function toggleRole(current: RoleName[], role: RoleName): RoleName[] {
  if (current.includes(role)) {
    const next = current.filter((item) => item !== role) as RoleName[]
    return next.length > 0 ? next : ['employee']
  }
  return [...current, role] as RoleName[]
}

function normalizeRoles(roles: string[]): RoleName[] {
  const next = roles.filter((role): role is RoleName => allRoles.includes(role as RoleName))
  return next.length > 0 ? next : ['employee']
}

function roleLabel(role: RoleName) {
  if (role === 'admin') return '管理员'
  if (role === 'reviewer') return '评审'
  if (role === 'acceptor') return '验收人'
  if (role === 'reward_approver') return '资金复核'
  return '员工'
}

function statusLabel(status: string) {
  if (status === 'enabled') return '启用'
  if (status === 'disabled') return '禁用'
  return status
}

export function UsersPage({ userId }: Props) {
  const toast = useToast()
  const [users, setUsers] = useState<UserProfile[]>([])
  const [roleDrafts, setRoleDrafts] = useState<Record<number, RoleName[]>>({})
  const [loading, setLoading] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordUserId, setPasswordUserId] = useState<number | null>(null)
  const [passwordDraft, setPasswordDraft] = useState('')
  const [forceChange, setForceChange] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const userCount = useMemo(() => users.length, [users])

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      setError(null)
      const rows = await requestJson<UserProfile[]>('/users', { userId })
      setUsers(rows)
      setRoleDrafts((prev) => {
        const next = { ...prev }
        for (const item of rows) {
          if (!next[item.id]) {
            next[item.id] = normalizeRoles(item.roles)
          }
        }
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载用户失败')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  const saveRoles = async (targetUserId: number) => {
    const roles = roleDrafts[targetUserId]
    if (!roles || roles.length === 0) {
      setError('至少保留一个角色')
      return
    }
    try {
      setError(null)
      await requestJson(`/users/${targetUserId}/roles`, {
        method: 'PUT',
        userId,
        body: { roles },
      })
      setMessage(`用户 #${targetUserId} 角色已更新`)
      await loadUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : '角色更新失败')
    }
  }

  const toggleUserStatus = async (target: UserProfile) => {
    const nextStatus = target.status === 'enabled' ? 'disabled' : 'enabled'
    const ok = window.confirm(`确认将用户 #${target.id} 设置为${statusLabel(nextStatus)}吗？`)
    if (!ok) {
      return
    }
    try {
      setError(null)
      await requestJson(`/users/${target.id}/status`, {
        method: 'PUT',
        userId,
        body: { status: nextStatus },
      })
      setMessage(`用户 #${target.id} 状态已更新为 ${statusLabel(nextStatus)}`)
      await loadUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : '状态更新失败')
    }
  }

  const openPasswordReset = (targetUserId: number) => {
    setPasswordUserId(targetUserId)
    setPasswordDraft('')
    setForceChange(true)
  }

  const closePasswordReset = () => {
    if (savingPassword) {
      return
    }
    setPasswordUserId(null)
    setPasswordDraft('')
    setForceChange(true)
  }

  const submitPasswordReset = async () => {
    if (!passwordUserId) {
      return
    }
    if (passwordDraft.length < 8) {
      setError('新密码至少 8 位')
      return
    }
    const ok = window.confirm(`确认重置用户 #${passwordUserId} 的密码吗？`)
    if (!ok) {
      return
    }

    try {
      setSavingPassword(true)
      setError(null)
      await requestJson(`/admin/users/${passwordUserId}/password`, {
        method: 'POST',
        userId,
        body: {
          new_password: passwordDraft,
          force_change: forceChange,
        },
      })
      setMessage(`用户 #${passwordUserId} 密码已重置`)
      closePasswordReset()
    } catch (err) {
      setError(err instanceof Error ? err.message : '密码重置失败')
    } finally {
      setSavingPassword(false)
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
        <h2>角色分配</h2>
        <p>用户来源统一为飞书登录+同步，本页用于角色分配、状态管理和密码重置。</p>
      </header>

      <article className="panel">
        <div className="panel-headline">
          <h3>用户列表（{userCount}）</h3>
          <button type="button" onClick={() => void loadUsers()} disabled={loading}>
            刷新
          </button>
        </div>
        <div className="table">
          <div className="row head wide-row">
            <span>ID</span>
            <span>姓名</span>
            <span>部门</span>
            <span>状态</span>
            <span>角色</span>
            <span>操作</span>
          </div>
          {users.map((item) => (
            <div className="row wide-row" key={item.id}>
              <span>#{item.id}</span>
              <span>{item.name}</span>
              <span>{item.department ?? '-'}</span>
              <span>{statusLabel(item.status)}</span>
              <span>
                <div className="actions">
                  {allRoles.map((role) => (
                    <label key={`row-${item.id}-${role}`}>
                      <input
                        type="checkbox"
                        checked={(roleDrafts[item.id] ?? normalizeRoles(item.roles)).includes(role)}
                        onChange={() =>
                          setRoleDrafts((prev) => ({
                            ...prev,
                            [item.id]: toggleRole(prev[item.id] ?? normalizeRoles(item.roles), role),
                          }))
                        }
                      />
                      {roleLabel(role)}
                    </label>
                  ))}
                </div>
              </span>
              <span className="actions">
                <button type="button" onClick={() => void saveRoles(item.id)}>
                  保存角色
                </button>
                <button type="button" onClick={() => void toggleUserStatus(item)}>
                  {item.status === 'enabled' ? '禁用' : '启用'}
                </button>
                <button type="button" onClick={() => openPasswordReset(item.id)}>
                  重置密码
                </button>
              </span>
            </div>
          ))}
        </div>
      </article>

      {passwordUserId && (
        <div className="modal-backdrop" onClick={closePasswordReset}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="reset-password-title">
            <div className="panel-headline">
              <h3 id="reset-password-title">重置密码（用户 #{passwordUserId}）</h3>
              <button type="button" onClick={closePasswordReset} disabled={savingPassword}>
                关闭
              </button>
            </div>
            <label>
              新密码（至少 8 位）
              <input
                type="password"
                value={passwordDraft}
                onChange={(event) => setPasswordDraft(event.target.value)}
                placeholder="请输入新密码"
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={forceChange}
                onChange={(event) => setForceChange(event.target.checked)}
              />
              下次登录强制修改密码
            </label>
            <div className="button-row">
              <button className="primary-btn" type="button" onClick={() => void submitPasswordReset()} disabled={savingPassword}>
                {savingPassword ? '提交中...' : '确认重置'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
