import { useCallback, useEffect, useState } from 'react'

import { acceptMilestone, listMyPendingMilestoneAcceptance } from '../lib/api'
import type { MilestonePendingAcceptance } from '../types'

type Props = {
  userId: number
  canAccept: boolean
  onChanged?: () => void
}

type Draft = {
  result: 'approved' | 'rework' | 'cancelled'
  comment: string
}

export function MilestoneAcceptancePanel({ userId, canAccept, onChanged }: Props) {
  const [items, setItems] = useState<MilestonePendingAcceptance[]>([])
  const [openId, setOpenId] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!canAccept) {
      setItems([])
      return
    }
    try {
      setError(null)
      setItems(await listMyPendingMilestoneAcceptance(userId))
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载里程碑待验收队列失败')
    }
  }, [canAccept, userId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  if (!canAccept) {
    return null
  }

  const ensureDraft = (milestoneId: number): Draft =>
    drafts[milestoneId] ?? { result: 'approved', comment: '里程碑验收通过。' }

  const submit = async (milestoneId: number) => {
    const draft = ensureDraft(milestoneId)
    try {
      setError(null)
      await acceptMilestone(userId, milestoneId, draft)
      await load()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交里程碑验收失败')
    }
  }

  return (
    <article className="panel">
      <div className="panel-headline">
        <h3>里程碑待验收</h3>
        <button type="button" onClick={() => void load()}>
          刷新
        </button>
      </div>
      {error && <p className="muted">{error}</p>}
      <div className="table">
        <div className="row head milestone-accept-row">
          <span>里程碑</span>
          <span>任务</span>
          <span>揭榜</span>
          <span>提交人</span>
          <span>提交时间</span>
          <span>操作</span>
        </div>
        {items.map((item) => {
          const open = openId === item.milestone_id
          const draft = ensureDraft(item.milestone_id)
          return (
            <div key={item.milestone_id}>
              <div className="row milestone-accept-row">
                <span>M{item.sequence}</span>
                <span title={item.task_title}>{item.task_title}</span>
                <span>
                  {(item.claim_mode === 'team' ? '组队' : '个人')}
                  {item.lead_user_name ? ` · ${item.lead_user_name}` : ''}
                </span>
                <span>{item.submitted_by_user_name || `用户${item.submitted_by_user_id}`}</span>
                <span>{new Date(item.submitted_at).toLocaleString()}</span>
                <span className="actions">
                  <button type="button" onClick={() => setOpenId(open ? null : item.milestone_id)}>
                    {open ? '收起' : '处理'}
                  </button>
                </span>
              </div>
              {open && (
                <div className="acceptance-editor">
                  <label>
                    结果
                    <select
                      value={draft.result}
                      onChange={(event) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [item.milestone_id]: { ...draft, result: event.target.value as Draft['result'] },
                        }))
                      }
                    >
                      <option value="approved">通过</option>
                      <option value="rework">整改</option>
                      <option value="cancelled">取消</option>
                    </select>
                  </label>
                  <label>
                    意见
                    <textarea
                      value={draft.comment}
                      onChange={(event) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [item.milestone_id]: { ...draft, comment: event.target.value },
                        }))
                      }
                    />
                  </label>
                  <div className="button-row">
                    <button className="primary-btn" type="button" onClick={() => void submit(item.milestone_id)}>
                      提交里程碑验收
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {items.length === 0 && <p className="muted">暂无里程碑待验收</p>}
      </div>
    </article>
  )
}
