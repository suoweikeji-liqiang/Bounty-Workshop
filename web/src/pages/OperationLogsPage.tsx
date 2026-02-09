import { useCallback, useEffect, useState } from 'react'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { OperationLog } from '../types'

type Props = {
  userId: number
}

export function OperationLogsPage({ userId }: Props) {
  const toast = useToast()
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
      setError(err instanceof Error ? err.message : '加载操作日志失败')
    } finally {
      setLoading(false)
    }
  }, [action, actorId, createdFrom, createdTo, limit, userId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!error) {
      return
    }
    toast.error(error)
  }, [error, toast])

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>操作日志</h2>
        <p>记录系统关键操作、审批行为与流程动作，便于审计追踪。</p>
      </header>
      <form
        className="panel form-grid"
        onSubmit={(event) => {
          event.preventDefault()
          void load()
        }}
      >
        <h3>筛选条件</h3>
        <label>
          操作类型
          <input value={action} onChange={(event) => setAction(event.target.value)} placeholder="例如：task.claim" />
        </label>
        <label>
          操作人 ID
          <input value={actorId} onChange={(event) => setActorId(event.target.value)} />
        </label>
        <label>
          开始日期
          <input type="date" value={createdFrom} onChange={(event) => setCreatedFrom(event.target.value)} />
        </label>
        <label>
          结束日期
          <input type="date" value={createdTo} onChange={(event) => setCreatedTo(event.target.value)} />
        </label>
        <label>
          条数上限
          <input type="number" min={1} max={1000} value={limit} onChange={(event) => setLimit(event.target.value)} />
        </label>
        <div className="button-row wide">
          <button className="primary-btn" type="submit" disabled={loading}>
            查询
          </button>
          <button type="button" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
        </div>
      </form>

      <article className="panel">
        <h3>日志记录（{rows.length}）</h3>
        <div className="table">
          <div className="row head wide-row op-log-row">
            <span>ID</span>
            <span>时间</span>
            <span>操作</span>
            <span>操作人</span>
            <span>目标</span>
            <span>详情</span>
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
