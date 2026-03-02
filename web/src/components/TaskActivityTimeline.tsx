import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { createTaskActivity, listClaimActivities, listTaskActivities } from '../lib/api'
import type { TaskActivity, TaskActivityType } from '../types'

type Props = {
  userId: number
  taskId: number
  claimId?: number | null
  title?: string
  defaultClaimId?: number | null
  showComposer?: boolean
  onChanged?: () => void
}

const activityTypeLabel: Record<TaskActivityType, string> = {
  comment: '评论',
  progress_update: '进展更新',
  blocker: '阻塞',
  official_note: '官方说明',
  system_event: '系统事件',
}

const composerTypes: Array<Extract<TaskActivityType, 'comment' | 'progress_update' | 'blocker'>> = [
  'comment',
  'progress_update',
  'blocker',
]

export function TaskActivityTimeline({
  userId,
  taskId,
  claimId,
  title = '任务时间线',
  defaultClaimId = null,
  showComposer = true,
  onChanged,
}: Props) {
  const [items, setItems] = useState<TaskActivity[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activityType, setActivityType] =
    useState<Extract<TaskActivityType, 'comment' | 'progress_update' | 'blocker'>>('comment')
  const [content, setContent] = useState('')
  const [composerClaimId, setComposerClaimId] = useState(
    claimId ?? defaultClaimId ? String(claimId ?? defaultClaimId) : '',
  )
  const [filters, setFilters] = useState<Record<TaskActivityType, boolean>>({
    comment: true,
    progress_update: true,
    blocker: true,
    official_note: true,
    system_event: true,
  })

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      if (claimId) {
        setItems(await listClaimActivities(userId, claimId))
      } else {
        setItems(await listTaskActivities(userId, taskId))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载时间线失败')
    } finally {
      setLoading(false)
    }
  }, [claimId, taskId, userId])

  useEffect(() => {
    void load()
  }, [load])

  const visibleItems = useMemo(
    () => items.filter((item) => filters[item.activity_type]),
    [filters, items],
  )

  const toggleFilter = (type: TaskActivityType) => {
    setFilters((prev) => ({ ...prev, [type]: !prev[type] }))
  }

  const submitComposer = async (event: FormEvent) => {
    event.preventDefault()
    const body: {
      activity_type: Extract<TaskActivityType, 'comment' | 'progress_update' | 'blocker'>
      content: string
      claim_id?: number
    } = {
      activity_type: activityType,
      content: content.trim(),
    }
    const parsedClaimId = Number(composerClaimId)
    if (Number.isInteger(parsedClaimId) && parsedClaimId > 0) {
      body.claim_id = parsedClaimId
    } else if (claimId) {
      body.claim_id = claimId
    }
    try {
      await createTaskActivity(userId, taskId, body)
      setContent('')
      await load()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败')
    }
  }

  return (
    <article className="panel">
      <div className="panel-headline">
        <h3>{title}</h3>
        <button type="button" onClick={() => void load()} disabled={loading}>
          刷新
        </button>
      </div>

      <div className="button-row">
        {(Object.keys(filters) as TaskActivityType[]).map((type) => (
          <button key={type} type="button" className={filters[type] ? 'primary-btn' : ''} onClick={() => toggleFilter(type)}>
            {activityTypeLabel[type]}
          </button>
        ))}
      </div>

      {showComposer && (
        <form className="form-grid" onSubmit={submitComposer}>
          <label>
            类型
            <select value={activityType} onChange={(event) => setActivityType(event.target.value as typeof activityType)}>
              {composerTypes.map((type) => (
                <option key={type} value={type}>
                  {activityTypeLabel[type]}
                </option>
              ))}
            </select>
          </label>
          <label>
            关联揭榜（可选）
            <input
              type="number"
              value={composerClaimId}
              onChange={(event) => setComposerClaimId(event.target.value)}
              placeholder="claim_id"
            />
          </label>
          <label className="wide">
            内容
            <textarea value={content} onChange={(event) => setContent(event.target.value)} required />
          </label>
          <div className="button-row wide">
            <button className="primary-btn" type="submit">
              发布
            </button>
          </div>
        </form>
      )}

      {error && <p className="muted">{error}</p>}
      <div className="table">
        <div className="row head activity-row">
          <span>时间</span>
          <span>类型</span>
          <span>用户</span>
          <span>揭榜</span>
          <span>内容</span>
          <span>详情</span>
        </div>
        {visibleItems.map((item) => (
          <div className="row activity-row" key={item.id}>
            <span>{new Date(item.created_at).toLocaleString()}</span>
            <span>{activityTypeLabel[item.activity_type]}</span>
            <span>#{item.actor_user_id}</span>
            <span>{item.claim_id ? `#${item.claim_id}` : '-'}</span>
            <span title={item.content}>{item.content}</span>
            <span>
              {Object.keys(item.detail ?? {}).length > 0 ? (
                <details>
                  <summary>查看</summary>
                  <pre className="json-pre">{JSON.stringify(item.detail, null, 2)}</pre>
                </details>
              ) : (
                '-'
              )}
            </span>
          </div>
        ))}
        {visibleItems.length === 0 && <p className="muted">暂无记录</p>}
      </div>
    </article>
  )
}
