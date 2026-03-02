import { useCallback, useEffect, useMemo, useState } from 'react'

import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { UserProfile } from '../types'

type Props = {
  userId: number
}

type RoleName = 'admin' | 'reviewer' | 'reward_approver' | 'acceptor' | 'employee'
type UserStatusFilter = 'all' | 'enabled' | 'disabled'
type RoleFilter = 'all' | RoleName

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

function statusTone(status: string): 'success' | 'warn' | 'danger' | 'info' | 'muted' {
  if (status === 'enabled') return 'success'
  if (status === 'disabled') return 'danger'
  return 'muted'
}

export function UsersPage({ userId }: Props) {
  const toast = useToast()
  const [users, setUsers] = useState<UserProfile[]>([])
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>('all')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [loading, setLoading] = useState(false)

  const [manageUserId, setManageUserId] = useState<number | null>(null)
  const [manageRoles, setManageRoles] = useState<RoleName[]>(['employee'])
  const [savingRoles, setSavingRoles] = useState(false)
  const [togglingStatus, setTogglingStatus] = useState(false)

  const [passwordOpen, setPasswordOpen] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordDraft, setPasswordDraft] = useState('')
  const [forceChange, setForceChange] = useState(true)

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const managedUser = useMemo(() => users.find((item) => item.id === manageUserId) ?? null, [manageUserId, users])

  const userCount = useMemo(() => users.length, [users])
  const filteredUsers = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()

    return users.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false
      }
      if (roleFilter !== 'all' && !normalizeRoles(item.roles).includes(roleFilter)) {
        return false
      }
      if (!normalizedKeyword) {
        return true
      }

      const rowText = [String(item.id), item.name, item.employee_no ?? '', item.department ?? '', item.email ?? '']
        .join(' ')
        .toLowerCase()

      return rowText.includes(normalizedKeyword)
    })
  }, [keyword, roleFilter, statusFilter, users])

  const filteredCount = useMemo(() => filteredUsers.length, [filteredUsers])
  const hasActiveFilters = keyword.trim().length > 0 || statusFilter !== 'all' || roleFilter !== 'all'

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      setError(null)
      const rows = await requestJson<UserProfile[]>('/users', { userId })
      setUsers(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载用户失败')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  const openManageUser = (user: UserProfile) => {
    setManageUserId(user.id)
    setManageRoles(normalizeRoles(user.roles))
    setPasswordOpen(false)
    setPasswordDraft('')
    setForceChange(true)
  }

  const closeManageUser = () => {
    if (savingRoles || savingPassword || togglingStatus) {
      return
    }
    setManageUserId(null)
    setManageRoles(['employee'])
    setPasswordOpen(false)
    setPasswordDraft('')
    setForceChange(true)
  }

  const saveRoles = async () => {
    if (!managedUser) {
      return
    }
    if (manageRoles.length === 0) {
      setError('至少保留一个角色')
      return
    }

    try {
      setSavingRoles(true)
      setError(null)
      await requestJson(`/users/${managedUser.id}/roles`, {
        method: 'PUT',
        userId,
        body: { roles: manageRoles },
      })
      setMessage(`用户 #${managedUser.id} 角色已更新`)
      await loadUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : '角色更新失败')
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
      setError(null)
      await requestJson(`/users/${managedUser.id}/status`, {
        method: 'PUT',
        userId,
        body: { status: nextStatus },
      })
      setMessage(`用户 #${managedUser.id} 状态已更新为${statusLabel(nextStatus)}`)
      await loadUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : '状态更新失败')
    } finally {
      setTogglingStatus(false)
    }
  }

  const submitPasswordReset = async () => {
    if (!managedUser) {
      return
    }
    if (passwordDraft.length < 8) {
      setError('新密码至少 8 位')
      return
    }

    try {
      setSavingPassword(true)
      setError(null)
      await requestJson(`/admin/users/${managedUser.id}/password`, {
        method: 'POST',
        userId,
        body: {
          new_password: passwordDraft,
          force_change: forceChange,
        },
      })
      setMessage(`用户 #${managedUser.id} 密码已重置`)
      setPasswordOpen(false)
      setPasswordDraft('')
      setForceChange(true)
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

  const resetFilters = () => {
    setKeyword('')
    setStatusFilter('all')
    setRoleFilter('all')
  }

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>角色分配</h2>
        <p>用于角色分配、账号状态管理和密码重置。</p>
      </header>

      <article className="panel">
        <div className="users-toolbar">
          <label className="users-toolbar-search">
            关键词搜索
            <input
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索 ID / 姓名 / 工号 / 部门 / 邮箱"
            />
          </label>
          <label>
            状态
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as UserStatusFilter)}
            >
              <option value="all">全部</option>
              <option value="enabled">启用</option>
              <option value="disabled">禁用</option>
            </select>
          </label>
          <label>
            角色
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}>
              <option value="all">全部</option>
              {allRoles.map((role) => (
                <option key={`filter-role-${role}`} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </select>
          </label>
          <div className="users-toolbar-actions">
            <button type="button" onClick={resetFilters} disabled={!hasActiveFilters}>
              重置筛选
            </button>
          </div>
        </div>

        <div className="panel-headline">
          <h3>
            用户列表（{filteredCount} / {userCount}）
          </h3>
          <button type="button" onClick={() => void loadUsers()} disabled={loading}>
            刷新
          </button>
        </div>

        <div className="table">
          <div className="row head users-row">
            <span>ID</span>
            <span>用户</span>
            <span>部门</span>
            <span>状态</span>
            <span>角色</span>
            <span>操作</span>
          </div>
          {filteredUsers.map((item) => (
            <div className="row users-row" key={item.id}>
              <span>#{item.id}</span>
              <span className="users-name-cell">
                <strong>{item.name}</strong>
                <small>
                  {item.employee_no ? `工号 ${item.employee_no}` : '无工号'} / {item.email ?? '无邮箱'}
                </small>
              </span>
              <span className="users-department-cell">{item.department ?? '未分配'}</span>
              <span>
                <StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge>
              </span>
              <span className="users-department-cell">{normalizeRoles(item.roles).map(roleLabel).join(' / ')}</span>
              <span className="users-action-group">
                <button type="button" onClick={() => openManageUser(item)}>
                  管理
                </button>
              </span>
            </div>
          ))}
          {filteredUsers.length === 0 && (
            <div className="row users-row users-empty-row">
              <span style={{ gridColumn: '1 / -1', textAlign: 'center' }}>
                当前筛选条件下没有匹配用户
              </span>
            </div>
          )}
        </div>
      </article>

      {managedUser && (
        <div className="modal-backdrop" onClick={closeManageUser}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="manage-user-title">
            <div className="panel-headline">
              <h3 id="manage-user-title">用户管理 #{managedUser.id}</h3>
              <button type="button" onClick={closeManageUser} disabled={savingRoles || savingPassword || togglingStatus}>
                关闭
              </button>
            </div>
            <p className="line-metric">
              <span>用户</span>
              <strong>{managedUser.name}</strong>
            </p>
            <p className="line-metric">
              <span>当前状态</span>
              <strong>{statusLabel(managedUser.status)}</strong>
            </p>
            <article className="modal-section">
              <h4>角色设置</h4>
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
                  {togglingStatus
                    ? '处理中...'
                    : managedUser.status === 'enabled'
                      ? '禁用账号'
                      : '启用账号'}
                </button>
              </div>
            </article>

            <article className="modal-section">
              <h4>密码重置</h4>
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
          </div>
        </div>
      )}
    </section>
  )
}
