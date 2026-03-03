import { useCallback, useEffect, useMemo, useState } from 'react'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { OperationLog, UserProfile } from '../types'

type Props = {
  userId: number
}

type LogQuery = {
  action: string
  actorId: string
  createdFrom: string
  createdTo: string
  limit: string
}

const defaultQuery: LogQuery = {
  action: '',
  actorId: '',
  createdFrom: '',
  createdTo: '',
  limit: '200',
}

function isSameQuery(a: LogQuery, b: LogQuery): boolean {
  return (
    a.action === b.action &&
    a.actorId === b.actorId &&
    a.createdFrom === b.createdFrom &&
    a.createdTo === b.createdTo &&
    a.limit === b.limit
  )
}

export function OperationLogsPage({ userId }: Props) {
  const toast = useToast()
  const [rows, setRows] = useState<OperationLog[]>([])
  const [users, setUsers] = useState<UserProfile[]>([])
  const [query, setQuery] = useState<LogQuery>(defaultQuery)
  const [queryDraft, setQueryDraft] = useState<LogQuery>(defaultQuery)
  const [actorSearch, setActorSearch] = useState('')
  const [selectedLog, setSelectedLog] = useState<OperationLog | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasQueryChanges = useMemo(() => !isSameQuery(query, queryDraft), [query, queryDraft])
  const userNameMap = useMemo(
    () => new Map<number, string>(users.map((item) => [item.id, item.name])),
    [users],
  )
  const filteredUsers = useMemo(() => {
    const keyword = actorSearch.trim().toLowerCase()
    if (!keyword) {
      return users
    }
    return users.filter((item) => {
      const value = `${item.name} ${item.department ?? ''} ${item.employee_no ?? ''}`.toLowerCase()
      return value.includes(keyword)
    })
  }, [actorSearch, users])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const params = new URLSearchParams()
      if (query.action.trim()) {
        params.set('action', query.action.trim())
      }
      const actor = Number(query.actorId)
      if (Number.isInteger(actor) && actor > 0) {
        params.set('actor_user_id', String(actor))
      }
      if (query.createdFrom) {
        params.set('created_from', query.createdFrom)
      }
      if (query.createdTo) {
        params.set('created_to', query.createdTo)
      }
      const limitValue = Number(query.limit)
      if (Number.isInteger(limitValue) && limitValue > 0) {
        params.set('limit', String(Math.min(limitValue, 1000)))
      }
      const suffix = params.toString() ? `?${params.toString()}` : ''
      const data = await requestJson<OperationLog[]>(`/operations/logs${suffix}`, { userId })
      setRows(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载操作日志失败')
    } finally {
      setLoading(false)
    }
  }, [query, userId])

  const loadUsers = useCallback(async () => {
    try {
      const rows = await requestJson<UserProfile[]>('/users/active', { userId })
      setUsers(rows)
    } catch {
      setUsers([])
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  const renderActorName = (item: OperationLog) => {
    if (item.actor_user_name?.trim()) {
      return item.actor_user_name
    }
    if (item.actor_user_id == null) {
      return '-'
    }
    return userNameMap.get(item.actor_user_id) ?? `用户${item.actor_user_id}`
  }

  useEffect(() => {
    if (!error) {
      return
    }
    toast.error(error)
  }, [error, toast])

  const applyQuery = () => {
    setQuery(queryDraft)
  }

  const resetQuery = () => {
    setQueryDraft(defaultQuery)
    setQuery(defaultQuery)
    setActorSearch('')
  }

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>操作日志</h2>
        <p>记录系统关键操作、审批行为与流程动作，便于审计追踪。</p>
      </header>
      <form
        className="panel filter-panel"
        onSubmit={(event) => {
          event.preventDefault()
          applyQuery()
        }}
      >
        <div className="panel-headline">
          <h3>筛选条件</h3>
        </div>
        <div className="filter-toolbar">
          <label className="filter-field grow">
            <span>操作类型</span>
            <input
              value={queryDraft.action}
              onChange={(event) => setQueryDraft((prev) => ({ ...prev, action: event.target.value }))}
              placeholder="例如：task.claim"
            />
          </label>
          <label className="filter-field">
            <span>搜索操作人</span>
            <input
              type="search"
              value={actorSearch}
              onChange={(event) => setActorSearch(event.target.value)}
              placeholder="按姓名/部门筛选"
            />
          </label>
          <label className="filter-field">
            <span>操作人</span>
            <select
              value={queryDraft.actorId}
              onChange={(event) => setQueryDraft((prev) => ({ ...prev, actorId: event.target.value }))}
            >
              <option value="">全部</option>
              {filteredUsers.map((item) => (
                <option key={`op-log-user-${item.id}`} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>开始日期</span>
            <input
              type="date"
              value={queryDraft.createdFrom}
              onChange={(event) => setQueryDraft((prev) => ({ ...prev, createdFrom: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>结束日期</span>
            <input
              type="date"
              value={queryDraft.createdTo}
              onChange={(event) => setQueryDraft((prev) => ({ ...prev, createdTo: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>条数上限</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={queryDraft.limit}
              onChange={(event) => setQueryDraft((prev) => ({ ...prev, limit: event.target.value }))}
            />
          </label>
          <div className="filter-actions">
            <button className="primary-btn" type="submit" disabled={loading || !hasQueryChanges}>
              应用筛选
            </button>
            <button type="button" onClick={resetQuery} disabled={loading}>
              重置
            </button>
            <button type="button" onClick={() => void load()} disabled={loading}>
              {loading ? '刷新中...' : '刷新'}
            </button>
          </div>
        </div>
      </form>

      <article className="panel">
        <div className="panel-headline">
          <h3>日志记录（{rows.length}）</h3>
          <span className="muted">最多显示 {Number(query.limit) || 200} 条</span>
        </div>
        <div className="table">
          <div className="row head op-log-row">
            <span>ID</span>
            <span>时间</span>
            <span>操作</span>
            <span>操作人</span>
            <span>目标</span>
            <span>操作</span>
          </div>
          {rows.map((item) => (
            <div className="row op-log-row" key={item.id}>
              <span>#{item.id}</span>
              <span>{new Date(item.created_at).toLocaleString()}</span>
              <span title={item.action}>{item.action}</span>
              <span>{renderActorName(item)}</span>
              <span>
                {item.target_type}#{item.target_id ?? '-'}
              </span>
              <span className="actions">
                <button type="button" onClick={() => setSelectedLog(item)}>
                  查看详情
                </button>
              </span>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="row op-log-row">
              <span style={{ gridColumn: '1 / -1', textAlign: 'center' }}>当前筛选条件下暂无日志。</span>
            </div>
          )}
        </div>
      </article>

      {selectedLog && (
        <div className="modal-backdrop" onClick={() => setSelectedLog(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="log-detail-title">
            <div className="panel-headline">
              <h3 id="log-detail-title">日志详情 #{selectedLog.id}</h3>
              <button type="button" onClick={() => setSelectedLog(null)}>
                关闭
              </button>
            </div>
            <p className="line-metric">
              <span>时间</span>
              <strong>{new Date(selectedLog.created_at).toLocaleString()}</strong>
            </p>
            <p className="line-metric">
              <span>操作</span>
              <strong>{selectedLog.action}</strong>
            </p>
            <p className="line-metric">
              <span>操作人</span>
              <strong>{renderActorName(selectedLog)}</strong>
            </p>
            <p className="line-metric">
              <span>目标</span>
              <strong>
                {selectedLog.target_type}#{selectedLog.target_id ?? '-'}
              </strong>
            </p>
            <article className="modal-section">
              <h4>详情 JSON</h4>
              <pre className="json-pre">{JSON.stringify(selectedLog.detail, null, 2)}</pre>
            </article>
          </div>
        </div>
      )}
    </section>
  )
}

