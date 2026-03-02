import { useCallback, useEffect, useMemo, useState } from 'react'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { Problem, ProblemDetail, ProblemReviewResult } from '../types'

type Props = {
  userId: number
}

const pointsRangeByLevel: Record<string, { min: number; max: number }> = {
  S: { min: 80, max: 150 },
  A: { min: 40, max: 80 },
  B: { min: 15, max: 40 },
  C: { min: 5, max: 15 },
}

export function BudgetReviewPage({ userId }: Props) {
  const toast = useToast()
  const [items, setItems] = useState<Problem[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<ProblemDetail | null>(null)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId])

  const pointsCompliance = useMemo(() => {
    if (!detail?.priced_level || typeof detail.priced_points !== 'number') {
      return null
    }
    const range = pointsRangeByLevel[detail.priced_level]
    if (!range) {
      return null
    }
    const ok = detail.priced_points >= range.min && detail.priced_points <= range.max
    return { ok, range }
  }, [detail])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const rows = await requestJson<Problem[]>('/problems?status=budget_pending', { userId })
      setItems(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载资金复核队列失败')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  const pick = async (problemId: number) => {
    setSelectedId(problemId)
    setComment('')
    try {
      setError(null)
      const payload = await requestJson<ProblemDetail>(`/problems/${problemId}`, { userId })
      setDetail(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载问题详情失败')
      setDetail(null)
    }
  }

  const submit = async (approve: boolean) => {
    if (!selected) return
    try {
      setError(null)
      const result = await requestJson<ProblemReviewResult>(`/problems/${selected.id}/budget-review`, {
        method: 'POST',
        userId,
        body: {
          approve,
          comment: comment.trim() || null,
        },
      })
      if (approve) {
        setMessage(`问题 #${selected.id} 资金复核通过，任务 #${result.id} 已生成`)
      } else {
        setMessage(`问题 #${selected.id} 已退回评审人重新定价`)
      }
      setSelectedId(null)
      setDetail(null)
      setComment('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '资金复核提交失败')
    }
  }

  useEffect(() => {
    if (!message) return
    toast.success(message)
  }, [message, toast])

  useEffect(() => {
    if (!error) return
    toast.error(error)
  }, [error, toast])

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>资金复核</h2>
        <p>仅复核金额与激励项，不改任务定义。</p>
      </header>

      <article className="panel">
        <div className="panel-headline">
          <h3>待复核问题（{items.length}）</h3>
          <button type="button" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
        </div>
        <div className="table">
          <div className="row head wide-row">
            <span>ID</span>
            <span>标题</span>
            <span>提交人</span>
            <span>时间</span>
            <span>操作</span>
          </div>
          {items.map((item) => (
            <div className="row wide-row" key={item.id}>
              <span>#{item.id}</span>
              <span>{item.title}</span>
              <span>{item.submitter_name || `#${item.submitter_id}`}</span>
              <span>{new Date(item.created_at).toLocaleString()}</span>
              <span className="actions">
                <button type="button" onClick={() => void pick(item.id)}>
                  {selectedId === item.id ? '已选中' : '查看'}
                </button>
              </span>
            </div>
          ))}
        </div>
      </article>

      {selected && detail && (
        <article className="panel form-grid">
          <h3>复核详情（问题 #{selected.id}）</h3>
          <p><strong>任务目标：</strong>{detail.draft_goal || '-'}</p>
          <p><strong>任务范围：</strong>{detail.draft_scope || '-'}</p>
          <p><strong>等级：</strong>{detail.priced_level || '-'}</p>
          <p><strong>金额：</strong>{detail.priced_reward_total ?? '-'}</p>
          <p><strong>提交人分成：</strong>{detail.priced_proposer_ratio ?? '-'}</p>
          <p><strong>验收人：</strong>{detail.priced_accepter_id ?? '-'}</p>
          <p><strong>积分/徽章：</strong>{detail.priced_points ?? 0} / {detail.priced_badge ?? '-'}</p>
          <p><strong>任务类型：</strong>{detail.priced_is_complex ? '复杂任务' : '普通任务'}</p>
          {detail.priced_is_complex && (
            <>
              <p><strong>结项比例：</strong>{detail.priced_closing_reward_ratio ?? 1}</p>
              <div>
                <strong>里程碑定义：</strong>
                <ul>
                  {(detail.priced_milestones ?? []).map((item, idx) => (
                    <li key={`milestone-${idx}`}>
                      M{item.sequence ?? idx + 1} {item.title ?? '-'} / 比例 {item.reward_ratio ?? '-'} /
                      目标 {item.goal ?? '-'}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
          {pointsCompliance && (
            <p className={pointsCompliance.ok ? 'muted' : ''}>
              <strong>积分区间校验：</strong>
              {pointsCompliance.ok
                ? `通过（${pointsCompliance.range.min}-${pointsCompliance.range.max}）`
                : `不通过（应为 ${pointsCompliance.range.min}-${pointsCompliance.range.max}）`}
            </p>
          )}

          <label className="wide">
            复核意见
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} />
          </label>
          <div className="button-row wide">
            <button className="primary-btn" type="button" onClick={() => void submit(true)}>
              通过并立项
            </button>
            <button type="button" onClick={() => void submit(false)}>
              退回重新定价
            </button>
          </div>
        </article>
      )}
    </section>
  )
}
