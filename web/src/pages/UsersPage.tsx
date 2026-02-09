import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { requestJson } from '../lib/http'
import type { UserProfile } from '../types'

type Props = {
  userId: number
}

type RoleName = 'admin' | 'reviewer' | 'acceptor' | 'employee'

type CreateUserForm = {
  name: string
  employee_no: string
  department: string
  email: string
  roles: RoleName[]
}

const allRoles: RoleName[] = ['admin', 'reviewer', 'acceptor', 'employee']

const defaultCreateForm: CreateUserForm = {
  name: '',
  employee_no: '',
  department: '',
  email: '',
  roles: ['employee'],
}

function toggleRole(current: RoleName[], role: RoleName): RoleName[] {
  if (current.includes(role)) {
    const next = current.filter((item) => item !== role) as RoleName[]
    return next.length > 0 ? next : ['employee']
  }
  return [...current, role] as RoleName[]
}

function normalizeRoles(roles: string[]): RoleName[] {
  const next = roles.filter((role): role is RoleName =>
    allRoles.includes(role as RoleName),
  )
  return next.length > 0 ? next : ['employee']
}

export function UsersPage({ userId }: Props) {
  const [users, setUsers] = useState<UserProfile[]>([])
  const [form, setForm] = useState<CreateUserForm>(defaultCreateForm)
  const [roleDrafts, setRoleDrafts] = useState<Record<number, RoleName[]>>({})
  const [loading, setLoading] = useState(false)
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

  const createUser = async (event: FormEvent) => {
    event.preventDefault()
    try {
      setError(null)
      await requestJson('/users', {
        method: 'POST',
        userId,
        body: {
          name: form.name,
          employee_no: form.employee_no || null,
          department: form.department || null,
          email: form.email || null,
          roles: form.roles,
        },
      })
      setMessage('用户创建成功')
      setForm(defaultCreateForm)
      await loadUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : '用户创建失败')
    }
  }

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
    try {
      setError(null)
      await requestJson(`/users/${target.id}/status`, {
        method: 'PUT',
        userId,
        body: { status: nextStatus },
      })
      setMessage(`用户 #${target.id} 状态已更新为 ${nextStatus}`)
      await loadUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : '状态更新失败')
    }
  }

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>用户管理</h2>
        <p>管理员维护用户角色与启用状态，确保权限矩阵落地。</p>
      </header>
      {message && <p className="ok-text">{message}</p>}
      {error && <p className="error-text">{error}</p>}

      <form className="panel form-grid" onSubmit={createUser}>
        <h3>新增用户</h3>
        <label>
          姓名
          <input
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            required
          />
        </label>
        <label>
          工号
          <input
            value={form.employee_no}
            onChange={(event) => setForm((prev) => ({ ...prev, employee_no: event.target.value }))}
          />
        </label>
        <label>
          部门
          <input
            value={form.department}
            onChange={(event) => setForm((prev) => ({ ...prev, department: event.target.value }))}
          />
        </label>
        <label>
          邮箱
          <input
            value={form.email}
            onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
          />
        </label>
        <div className="wide checks">
          {allRoles.map((role) => (
            <label key={`create-${role}`}>
              <input
                type="checkbox"
                checked={form.roles.includes(role)}
                onChange={() =>
                  setForm((prev) => ({ ...prev, roles: toggleRole(prev.roles, role) }))
                }
              />
              {role}
            </label>
          ))}
        </div>
        <button className="primary-btn" type="submit">
          创建用户
        </button>
      </form>

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
              <span>{item.status}</span>
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
                      {role}
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
              </span>
            </div>
          ))}
        </div>
      </article>
    </section>
  )
}
