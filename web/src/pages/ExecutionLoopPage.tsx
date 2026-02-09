import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type {
  AcceptanceTemplatesConfig,
  ClaimExecution,
  ClaimExecutionDetail,
  PendingAcceptance,
  Reward,
  UserProfile,
} from '../types'

type Props = {
  userId: number
  profile: UserProfile | null
}

type AcceptanceResult = 'approved' | 'rework' | 'rejected'

type AcceptanceDraft = {
  result: AcceptanceResult
  comment: string
}

type TemplateDraft = {
  approved: string
  rework: string
  rejected: string
}

const defaultTemplates: AcceptanceTemplatesConfig = {
  approved: ['验收通过：已满足任务目标和验收标准。'],
  rework: ['需要整改：请补充关键证据后重新提交。'],
  rejected: ['不通过：未达到核心验收标准。'],
}

function normalizeTemplates(payload: AcceptanceTemplatesConfig): AcceptanceTemplatesConfig {
  const approved = payload.approved.map((item) => item.trim()).filter(Boolean)
  const rework = payload.rework.map((item) => item.trim()).filter(Boolean)
  const rejected = payload.rejected.map((item) => item.trim()).filter(Boolean)

  return {
    approved: approved.length > 0 ? approved : defaultTemplates.approved,
    rework: rework.length > 0 ? rework : defaultTemplates.rework,
    rejected: rejected.length > 0 ? rejected : defaultTemplates.rejected,
  }
}

function templatesToDraft(payload: AcceptanceTemplatesConfig): TemplateDraft {
  return {
    approved: payload.approved.join('\n'),
    rework: payload.rework.join('\n'),
    rejected: payload.rejected.join('\n'),
  }
}

function parseTemplateInput(text: string): string[] {
  return text
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function defaultComment(templates: AcceptanceTemplatesConfig, result: AcceptanceResult) {
  return templates[result][0] ?? ''
}

export function ExecutionLoopPage({ userId, profile }: Props) {
  const toast = useToast()
  const [claims, setClaims] = useState<ClaimExecution[]>([])
  const [pendingAcceptance, setPendingAcceptance] = useState<PendingAcceptance[]>([])
  const [rewards, setRewards] = useState<Reward[]>([])
  const [claimId, setClaimId] = useState('')
  const [summary, setSummary] = useState('')
  const [attachmentIds, setAttachmentIds] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<ClaimExecutionDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [activeAcceptanceId, setActiveAcceptanceId] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<Record<number, AcceptanceDraft>>({})
  const [templates, setTemplates] = useState<AcceptanceTemplatesConfig>(defaultTemplates)
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft>(templatesToDraft(defaultTemplates))
  const [savingTemplates, setSavingTemplates] = useState(false)

  const canAccept = useMemo(
    () => Boolean(profile?.roles.includes('admin') || profile?.roles.includes('acceptor')),
    [profile],
  )
  const canConfirmReward = useMemo(
    () => Boolean(profile?.roles.includes('admin') || profile?.roles.includes('reviewer')),
    [profile],
  )
  const canSubmitDeliverable = useMemo(
    () =>
      Boolean(
        profile?.roles.some((role) =>
          ['employee', 'admin', 'reviewer', 'acceptor'].includes(role),
        ),
      ),
    [profile],
  )
  const canManageTemplates = useMemo(() => Boolean(profile?.roles.includes('admin')), [profile])

  const loadTemplates = useCallback(async () => {
    if (!canAccept) {
      setTemplates(defaultTemplates)
      setTemplateDraft(templatesToDraft(defaultTemplates))
      return
    }
    try {
      const payload = await requestJson<AcceptanceTemplatesConfig>(
        '/system/config/acceptance-templates',
        { userId },
      )
      const normalized = normalizeTemplates(payload)
      setTemplates(normalized)
      setTemplateDraft(templatesToDraft(normalized))
    } catch {
      setTemplates(defaultTemplates)
      setTemplateDraft(templatesToDraft(defaultTemplates))
    }
  }, [canAccept, userId])

  const load = useCallback(async () => {
    try {
      setError(null)
      const claimData = await requestJson<ClaimExecution[]>('/claims/mine', { userId })
      setClaims(claimData)
      if (canAccept) {
        const pendingData = await requestJson<PendingAcceptance[]>(
          '/deliverables/pending-acceptance/mine',
          {
            userId,
          },
        )
        setPendingAcceptance(pendingData)
      } else {
        setPendingAcceptance([])
      }
      if (canConfirmReward) {
        const rewardData = await requestJson<Reward[]>('/rewards', { userId })
        setRewards(rewardData)
      } else {
        setRewards([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed')
    }
  }, [canAccept, canConfirmReward, userId])

  useEffect(() => {
    void load()
    void loadTemplates()
  }, [load, loadTemplates])

  const submitDeliverable = async (event: FormEvent) => {
    event.preventDefault()
    try {
      setError(null)
      const evidenceAttachmentIds = attachmentIds
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item > 0)
      await requestJson(`/claims/${claimId}/deliverables`, {
        method: 'POST',
        userId,
        body: {
          summary,
          criteria_results: ['from execution loop page'],
          evidence_attachment_ids: evidenceAttachmentIds,
          evidence_urls: [],
        },
      })
      setMessage('deliverable submitted')
      setClaimId('')
      setSummary('')
      setAttachmentIds('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'submit failed')
    }
  }

  const openDetail = async (targetClaimId: number) => {
    try {
      setError(null)
      const payload = await requestJson<ClaimExecutionDetail>(`/claims/${targetClaimId}/detail`, { userId })
      setDetail(payload)
      setDetailOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'detail load failed')
    }
  }

  const ensureDraft = (deliverableId: number): AcceptanceDraft =>
    drafts[deliverableId] ?? { result: 'approved', comment: defaultComment(templates, 'approved') }

  const setDraft = (deliverableId: number, next: AcceptanceDraft) => {
    setDrafts((prev) => ({ ...prev, [deliverableId]: next }))
  }

  const handleResultChange = (deliverableId: number, result: AcceptanceResult) => {
    setDraft(deliverableId, { result, comment: defaultComment(templates, result) })
  }

  const applyTemplate = (deliverableId: number, result: AcceptanceResult, comment: string) => {
    setDraft(deliverableId, { result, comment })
  }

  const submitAcceptance = async (deliverableId: number) => {
    const draft = ensureDraft(deliverableId)
    try {
      await requestJson(`/deliverables/${deliverableId}/accept`, {
        method: 'POST',
        userId,
        body: { result: draft.result, comment: draft.comment },
      })
      setMessage(`acceptance submitted: ${draft.result}`)
      setActiveAcceptanceId(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'accept failed')
    }
  }

  const confirmReward = async (rewardId: number) => {
    try {
      await requestJson(`/rewards/${rewardId}/confirm`, {
        method: 'POST',
        userId,
      })
      setMessage(`reward #${rewardId} confirmed`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'confirm failed')
    }
  }

  const abandonClaim = async (targetClaimId: number) => {
    try {
      await requestJson(`/claims/${targetClaimId}/abandon`, {
        method: 'POST',
        userId,
      })
      setMessage(`claim #${targetClaimId} abandoned`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'abandon failed')
    }
  }

  const saveTemplates = async () => {
    if (!canManageTemplates) {
      return
    }

    const payload: AcceptanceTemplatesConfig = {
      approved: parseTemplateInput(templateDraft.approved),
      rework: parseTemplateInput(templateDraft.rework),
      rejected: parseTemplateInput(templateDraft.rejected),
    }

    if (payload.approved.length === 0 || payload.rework.length === 0 || payload.rejected.length === 0) {
      setError('each result needs at least one template')
      return
    }

    try {
      setSavingTemplates(true)
      setError(null)
      const result = await requestJson<AcceptanceTemplatesConfig>(
        '/system/config/acceptance-templates',
        {
          method: 'PUT',
          userId,
          body: payload,
        },
      )
      const normalized = normalizeTemplates(result)
      setTemplates(normalized)
      setTemplateDraft(templatesToDraft(normalized))
      setMessage('templates updated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'template save failed')
    } finally {
      setSavingTemplates(false)
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
        <h2>执行闭环</h2>
        <p>claim execution, deliverable submission, acceptance and reward confirmation.</p>
      </header>

      {canManageTemplates && (
        <article className="panel form-grid">
          <h3>验收评论模板配置</h3>
          <label className="wide">
            approved (one line each)
            <textarea
              value={templateDraft.approved}
              onChange={(event) =>
                setTemplateDraft((prev) => ({ ...prev, approved: event.target.value }))
              }
            />
          </label>
          <label className="wide">
            rework (one line each)
            <textarea
              value={templateDraft.rework}
              onChange={(event) =>
                setTemplateDraft((prev) => ({ ...prev, rework: event.target.value }))
              }
            />
          </label>
          <label className="wide">
            rejected (one line each)
            <textarea
              value={templateDraft.rejected}
              onChange={(event) =>
                setTemplateDraft((prev) => ({ ...prev, rejected: event.target.value }))
              }
            />
          </label>
          <button type="button" onClick={() => void saveTemplates()} disabled={savingTemplates}>
            {savingTemplates ? 'saving...' : 'save templates'}
          </button>
        </article>
      )}

      <article className="panel">
        <div className="panel-headline">
          <h3>我的揭榜记录</h3>
          <button type="button" onClick={() => void load()}>
            refresh
          </button>
        </div>
        <div className="table">
          <div className="row head wide-row">
            <span>claim</span>
            <span>task</span>
            <span>claim status</span>
            <span>task status</span>
            <span>deliverable</span>
            <span>actions</span>
          </div>
          {claims.map((item) => (
            <div className="row wide-row" key={item.claim_id}>
              <span>#{item.claim_id}</span>
              <span>{item.task_title}</span>
              <span>{item.claim_status}</span>
              <span>{item.task_status}</span>
              <span>{item.deliverable_status ?? '-'}</span>
              <span className="actions">
                <button
                  type="button"
                  onClick={() => {
                    setClaimId(String(item.claim_id))
                    void openDetail(item.claim_id)
                  }}
                >
                  detail
                </button>
                {item.claim_status === 'active' && (
                  <button type="button" onClick={() => void abandonClaim(item.claim_id)}>
                    abandon
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      </article>

      {canSubmitDeliverable && (
        <form className="panel form-grid" onSubmit={submitDeliverable}>
          <h3>提交成果</h3>
          <label>
            claim_id
            <input value={claimId} onChange={(event) => setClaimId(event.target.value)} required />
          </label>
          <label className="wide">
            summary
            <textarea value={summary} onChange={(event) => setSummary(event.target.value)} required />
          </label>
          <label className="wide">
            evidence attachment IDs (comma separated)
            <input
              value={attachmentIds}
              onChange={(event) => setAttachmentIds(event.target.value)}
              placeholder="e.g. 12,13"
            />
          </label>
          <button className="primary-btn" type="submit">
            submit deliverable
          </button>
        </form>
      )}

      {canAccept && (
        <article className="panel">
          <h3>待我验收</h3>
          <div className="table">
            <div className="row head wide-row">
              <span>deliverable</span>
              <span>claim</span>
              <span>task</span>
              <span>submitter</span>
              <span>submitted at</span>
              <span>actions</span>
            </div>
            {pendingAcceptance.map((item) => {
              const draft = ensureDraft(item.deliverable_id)
              const openEditor = activeAcceptanceId === item.deliverable_id
              return (
                <div key={item.deliverable_id}>
                  <div className="row wide-row">
                    <span>#{item.deliverable_id}</span>
                    <span>#{item.claim_id}</span>
                    <span>{item.task_title}</span>
                    <span>#{item.lead_user_id}</span>
                    <span>{new Date(item.submitted_at).toLocaleString()}</span>
                    <span className="actions">
                      <button type="button" onClick={() => void openDetail(item.claim_id)}>
                        detail
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveAcceptanceId(openEditor ? null : item.deliverable_id)}
                      >
                        {openEditor ? 'hide' : 'acceptance panel'}
                      </button>
                    </span>
                  </div>
                  {openEditor && (
                    <div className="acceptance-editor">
                      <label>
                        result
                        <select
                          value={draft.result}
                          onChange={(event) =>
                            handleResultChange(item.deliverable_id, event.target.value as AcceptanceResult)
                          }
                        >
                          <option value="approved">approved</option>
                          <option value="rework">rework</option>
                          <option value="rejected">rejected</option>
                        </select>
                      </label>
                      <div className="template-row">
                        {templates[draft.result].map((template) => (
                          <button
                            key={template}
                            type="button"
                            className="chip-btn"
                            onClick={() => applyTemplate(item.deliverable_id, draft.result, template)}
                          >
                            {template}
                          </button>
                        ))}
                      </div>
                      <label>
                        comment
                        <textarea
                          value={draft.comment}
                          onChange={(event) =>
                            setDraft(item.deliverable_id, { ...draft, comment: event.target.value })
                          }
                        />
                      </label>
                      <div className="button-row">
                        <button
                          className="primary-btn"
                          type="button"
                          onClick={() => void submitAcceptance(item.deliverable_id)}
                        >
                          submit acceptance
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </article>
      )}

      {canConfirmReward && (
        <article className="panel">
          <h3>激励确认</h3>
          <div className="table">
            <div className="row head wide-row">
              <span>ID</span>
              <span>task</span>
              <span>user</span>
              <span>amount</span>
              <span>status</span>
              <span>action</span>
            </div>
            {rewards.map((item) => (
              <div className="row wide-row" key={item.id}>
                <span>#{item.id}</span>
                <span>#{item.task_id}</span>
                <span>#{item.user_id}</span>
                <span>¥{item.amount.toFixed(2)}</span>
                <span>{item.status}</span>
                <span>
                  {item.status === 'generated' ? (
                    <button type="button" onClick={() => void confirmReward(item.id)}>
                      confirm
                    </button>
                  ) : (
                    'confirmed'
                  )}
                </span>
              </div>
            ))}
          </div>
        </article>
      )}

      {detailOpen && detail && (
        <div className="modal-backdrop" onClick={() => setDetailOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="panel-headline">
              <h3>Claim #{detail.claim_id} detail</h3>
              <button type="button" onClick={() => setDetailOpen(false)}>
                close
              </button>
            </div>
            <p className="line-metric">
              <span>task</span>
              <strong>{detail.task_title}</strong>
            </p>
            <p className="line-metric">
              <span>goal</span>
              <strong>{detail.task_goal}</strong>
            </p>
            <p className="line-metric">
              <span>scope</span>
              <strong>{detail.task_scope}</strong>
            </p>
            <p className="line-metric">
              <span>status</span>
              <strong>
                {detail.claim_status} / {detail.task_status}
              </strong>
            </p>
            <p className="line-metric">
              <span>due</span>
              <strong>{detail.due_date}</strong>
            </p>

            <article className="modal-section">
              <h4>acceptance criteria</h4>
              <ul>
                {detail.acceptance_criteria.map((item, idx) => (
                  <li key={`${item.description ?? 'item'}-${idx}`}>
                    {item.description ?? 'unnamed criteria'} ({item.type ?? 'unknown'})
                  </li>
                ))}
              </ul>
            </article>

            <article className="modal-section">
              <h4>deliverable</h4>
              <p>{detail.deliverable_summary ?? 'no deliverable yet'}</p>
              {detail.criteria_results.length > 0 && (
                <ul>
                  {detail.criteria_results.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </article>

            <article className="modal-section">
              <h4>evidence links</h4>
              {detail.evidence_urls.length === 0 ? (
                <p className="muted">no evidence links</p>
              ) : (
                <ul>
                  {detail.evidence_urls.map((url, idx) => (
                    <li key={`${url}-${idx}`}>
                      <a href={url} target="_blank" rel="noreferrer">
                        open evidence #{idx + 1}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="modal-section">
              <h4>acceptance history</h4>
              {detail.acceptance_history.length === 0 ? (
                <p className="muted">no acceptance history</p>
              ) : (
                <ul>
                  {detail.acceptance_history.map((item) => (
                    <li key={item.acceptance_id}>
                      [{item.result}] {item.comment ?? '-'} ({new Date(item.created_at).toLocaleString()})
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>
        </div>
      )}
    </section>
  )
}
