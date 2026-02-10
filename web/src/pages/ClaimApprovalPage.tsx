import { useCallback, useEffect, useMemo, useState } from 'react'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import { hasAnyRole } from '../lib/roles'
import type { ClaimApprovalRequest, UserProfile } from '../types'

type Props = {
  userId: number
  profile: UserProfile | null
}

export function ClaimApprovalPage({ userId, profile }: Props) {
  const toast = useToast()
  const [mine, setMine] = useState<ClaimApprovalRequest[]>([])
  const [reviewRows, setReviewRows] = useState<ClaimApprovalRequest[]>([])
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [commentDraft, setCommentDraft] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canReview = useMemo(() => hasAnyRole(profile, ['admin', 'reviewer']), [profile])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const mineRows = await requestJson<ClaimApprovalRequest[]>(
        '/claims/overdue-approvals/mine?status=pending',
        { userId },
      )
      setMine(mineRows)

      if (canReview) {
        const rows = await requestJson<ClaimApprovalRequest[]>(
          `/claims/overdue-approvals/pending?status=${status}`,
          { userId },
        )
        setReviewRows(rows)
      } else {
        setReviewRows([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载审批请求失败')
    } finally {
      setLoading(false)
    }
  }, [canReview, status, userId])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (id: number, action: 'approve' | 'reject') => {
    try {
      setError(null)
      const comment = (commentDraft[id] ?? '').trim()
      await requestJson(`/claims/overdue-approvals/${id}/${action}`, {
        method: 'POST',
        userId,
        body: { comment: comment || null },
      })
      setMessage(`审批请求 #${id} 已${action === 'approve' ? '通过' : '驳回'}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action === 'approve' ? '通过' : '驳回'}失败`)
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
        <h2>揭榜审批</h2>
        <p>超期用户在此提交审批请求，审核人/管理员可通过或驳回。</p>
      </header>

      <article className="panel">
        <div className="panel-headline">
          <h3>我的待处理审批</h3>
          <button type="button" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
        </div>
        {mine.length === 0 ? (
          <p className="muted">暂无待处理审批请求。</p>
        ) : (
          <div className="table">
            <div className="row head wide-row approval-row">
              <span>请求</span>
              <span>任务</span>
              <span>状态</span>
              <span>原因</span>
              <span>创建时间</span>
            </div>
            {mine.map((item) => (
              <div className="row wide-row approval-row" key={item.id}>
                <span>#{item.id}</span>
                <span>
                  #{item.task_id} {item.task_title}
                </span>
                <span>{item.status}</span>
                <span>{item.reason ?? '-'}</span>
                <span>{new Date(item.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </article>

      {canReview && (
        <article className="panel">
          <div className="panel-headline">
            <h3>审批队列</h3>
            <div className="button-row">
              <button type="button" onClick={() => setStatus('pending')}>
                待处理
              </button>
              <button type="button" onClick={() => setStatus('approved')}>
                已通过
              </button>
              <button type="button" onClick={() => setStatus('rejected')}>
                已驳回
              </button>
            </div>
          </div>
          {reviewRows.length === 0 ? (
            <p className="muted">当前筛选条件下暂无请求。</p>
          ) : (
            <div className="table">
              <div className="row head wide-row approval-review-row">
                <span>请求</span>
                <span>任务</span>
                <span>申请人</span>
                <span>超期次数</span>
                <span>状态</span>
                <span>审核时间</span>
                <span>操作</span>
              </div>
              {reviewRows.map((item) => (
                <div className="row wide-row approval-review-row" key={item.id}>
                  <span>#{item.id}</span>
                  <span>
                    #{item.task_id} {item.task_title}
                  </span>
                  <span>
                    #{item.applicant_user_id} {item.applicant_user_name}
                  </span>
                  <span>{item.applicant_overdue_count}</span>
                  <span>{item.status}</span>
                  <span>{item.reviewed_at ? new Date(item.reviewed_at).toLocaleString() : '-'}</span>
                  <span className="actions">
                    {item.status === 'pending' ? (
                      <>
                        <input
                          value={commentDraft[item.id] ?? ''}
                          onChange={(event) =>
                            setCommentDraft((prev) => ({ ...prev, [item.id]: event.target.value }))
                          }
                          placeholder="审核意见"
                        />
                        <button type="button" onClick={() => void act(item.id, 'approve')}>
                          通过
                        </button>
                        <button type="button" onClick={() => void act(item.id, 'reject')}>
                          驳回
                        </button>
                      </>
                    ) : (
                      <span>{item.reason ?? '-'}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>
      )}
    </section>
  )
}
