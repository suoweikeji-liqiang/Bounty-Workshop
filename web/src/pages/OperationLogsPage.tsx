import { useCallback, useEffect, useState } from 'react'

import { requestJson } from '../lib/http'
import type { OperationLog } from '../types'

type Props = {
  userId: number
}

export function OperationLogsPage({ userId }: Props) {
  const [rows, setRows] = useState<OperationLog[]>([])
  const [action, setAction] = useState('')
  const [actorId, setActorId] = useState('')
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')
  const [limit, setLimit] = useState('200')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const query = new URLSearchParams()
      if (action.trim()) {
        query.set('action', action.trim())
      }
      const actor = Number(actorId)
      if (Number.isInteger(actor) && actor > 0) {
        query.set('actor_user_id', String(actor))
      }
      if (createdFrom) {
        query.set('created_from', createdFrom)
      }
      if (createdTo) {
        query.set('created_to', createdTo)
      }
      const limitValue = Number(limit)
      if (Number.isInteger(limitValue) && limitValue > 0) {
        query.set('limit', String(Math.min(limitValue, 1000)))
      }
      const suffix = query.toString() ? `?${query.toString()}` : ''
      const data = await requestJson<OperationLog[]>(`/operations/logs${suffix}`, { userId })
      setRows(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load operation logs')
    } finally {
      setLoading(false)
    }
  }, [action, actorId, createdFrom, createdTo, limit, userId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>Operation Logs</h2>
        <p>Audit logs for key system operations, approvals, and workflow actions.</p>
      </header>
      {error && <p className="error-text">{error}</p>}
      <form
        className="panel form-grid"
        onSubmit={(event) => {
          event.preventDefault()
          void load()
        }}
      >
        <h3>Filters</h3>
        <label>
          action
          <input value={action} onChange={(event) => setAction(event.target.value)} placeholder="e.g. task.claim" />
        </label>
        <label>
          actor_user_id
          <input value={actorId} onChange={(event) => setActorId(event.target.value)} />
        </label>
        <label>
          created_from
          <input type="date" value={createdFrom} onChange={(event) => setCreatedFrom(event.target.value)} />
        </label>
        <label>
          created_to
          <input type="date" value={createdTo} onChange={(event) => setCreatedTo(event.target.value)} />
        </label>
        <label>
          limit
          <input type="number" min={1} max={1000} value={limit} onChange={(event) => setLimit(event.target.value)} />
        </label>
        <div className="button-row wide">
          <button className="primary-btn" type="submit" disabled={loading}>
            query
          </button>
          <button type="button" onClick={() => void load()} disabled={loading}>
            refresh
          </button>
        </div>
      </form>

      <article className="panel">
        <h3>Log Rows ({rows.length})</h3>
        <div className="table">
          <div className="row head wide-row op-log-row">
            <span>id</span>
            <span>time</span>
            <span>action</span>
            <span>actor</span>
            <span>target</span>
            <span>detail</span>
          </div>
          {rows.map((item) => (
            <div className="row wide-row op-log-row" key={item.id}>
              <span>#{item.id}</span>
              <span>{new Date(item.created_at).toLocaleString()}</span>
              <span>{item.action}</span>
              <span>{item.actor_user_id ?? '-'}</span>
              <span>
                {item.target_type}#{item.target_id ?? '-'}
              </span>
              <span>{JSON.stringify(item.detail)}</span>
            </div>
          ))}
        </div>
      </article>
    </section>
  )
}
