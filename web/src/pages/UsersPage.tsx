import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import { allRoles, normalizeRoles, roleLabel, statusLabel, statusTone, type RoleName } from '../lib/userRoles'
import type { UserProfile } from '../types'

type Props = {
  userId: number
}

type UserStatusFilter = 'all' | 'enabled' | 'disabled'
type RoleFilter = 'all' | RoleName

export function UsersPage({ userId }: Props) {
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [users, setUsers] = useState<UserProfile[]>([])
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>('all')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const encodedBack = encodeURIComponent(`${location.pathname}${location.search}`)

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>角色分配</h2>
        <p>用于角色分配、账号状态管理和密码重置。</p>
      </header>

      <article className="panel filter-panel">
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
                <button
                  type="button"
                  onClick={() => navigate(`/users/${item.id}/manage?back=${encodedBack}`)}
                >
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
    </section>
  )
}
