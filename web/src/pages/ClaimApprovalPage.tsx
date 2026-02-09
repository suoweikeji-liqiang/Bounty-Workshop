import { useCallback, useEffect, useMemo, useState } from 'react'

import { requestJson } from '../lib/http'
import type { ClaimApprovalRequest, UserProfile } from '../types'

type Props = {
  userId: number
  profile: UserProfile | null
}

function hasAnyRole(profile: UserProfile | null, roles: string[]) {
  if (!profile) {
    return false
  }
  return profile.roles.some((role) => roles.includes(role))
}

export function ClaimApprovalPage({ userId, profile }: Props) {
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
      setError(err instanceof Error ? err.message : 'failed to load approval requests')
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
      setMessage(`request #${id} ${action}d`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`)
    }
  }

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>Claim Approvals</h2>
        <p>Overdue users submit approval requests here. Reviewer/admin can approve or reject.</p>
      </header>
      {message && <p className="ok-text">{message}</p>}
      {error && <p className="error-text">{error}</p>}

      <article className="panel">
        <div className="panel-headline">
          <h3>My Pending Requests</h3>
          <button type="button" onClick={() => void load()} disabled={loading}>
            refresh
          </button>
        </div>
        {mine.length === 0 ? (
          <p className="muted">No pending approval requests.</p>
        ) : (
          <div className="table">
            <div className="row head wide-row approval-row">
              <span>request</span>
              <span>task</span>
              <span>status</span>
              <span>reason</span>
              <span>created</span>
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
            <h3>Review Queue</h3>
            <div className="button-row">
              <button type="button" onClick={() => setStatus('pending')}>
                pending
              </button>
              <button type="button" onClick={() => setStatus('approved')}>
                approved
              </button>
              <button type="button" onClick={() => setStatus('rejected')}>
                rejected
              </button>
            </div>
          </div>
          {reviewRows.length === 0 ? (
            <p className="muted">No requests in current filter.</p>
          ) : (
            <div className="table">
              <div className="row head wide-row approval-review-row">
                <span>request</span>
                <span>task</span>
                <span>applicant</span>
                <span>overdue</span>
                <span>status</span>
                <span>reviewed</span>
                <span>actions</span>
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
                          placeholder="review comment"
                        />
                        <button type="button" onClick={() => void act(item.id, 'approve')}>
                          approve
                        </button>
                        <button type="button" onClick={() => void act(item.id, 'reject')}>
                          reject
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
