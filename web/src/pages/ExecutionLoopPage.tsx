import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { AttachmentField } from '../components/AttachmentField'
import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type {
  Attachment,
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
  approved: ['Accepted: deliverable meets acceptance criteria.'],
  rework: ['Needs rework: please address missing evidence and resubmit.'],
  rejected: ['Rejected: core acceptance criteria were not met.'],
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

function formatAcceptanceResult(result: AcceptanceResult) {
  if (result === 'approved') {
    return 'Approved'
  }
  if (result === 'rework') {
    return 'Rework'
  }
  return 'Rejected'
}

function formatCommonStatus(status: string | null | undefined) {
  if (!status) {
    return '-'
  }

  const map: Record<string, string> = {
    active: 'Active',
    in_progress: 'In Progress',
    submitted: 'Submitted',
    approved: 'Approved',
    rework: 'Rework',
    rejected: 'Rejected',
    generated: 'Generated',
    confirmed: 'Confirmed',
    completed: 'Completed',
    abandoned: 'Abandoned',
  }

  return map[status] ?? status
}

export function ExecutionLoopPage({ userId, profile }: Props) {
  const toast = useToast()
  const [claims, setClaims] = useState<ClaimExecution[]>([])
  const [pendingAcceptance, setPendingAcceptance] = useState<PendingAcceptance[]>([])
  const [rewards, setRewards] = useState<Reward[]>([])
  const [claimId, setClaimId] = useState('')
  const [summary, setSummary] = useState('')
  const [uploadedAttachments, setUploadedAttachments] = useState<Attachment[]>([])
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
        profile?.roles.some((role) => ['employee', 'admin', 'reviewer', 'acceptor'].includes(role)),
      ),
    [profile],
  )
  const canManageTemplates = useMemo(() => Boolean(profile?.roles.includes('admin')), [profile])
  const deliverableClaimOptions = useMemo(
    () =>
      claims
        .filter((item) => item.claim_status === 'active')
        .sort((a, b) => b.claim_id - a.claim_id),
    [claims],
  )

  const handleUploadedAttachmentsChange = (next: Attachment[]) => {
    setUploadedAttachments(next)
  }

  const loadTemplates = useCallback(async () => {
    if (!canAccept) {
      setTemplates(defaultTemplates)
      setTemplateDraft(templatesToDraft(defaultTemplates))
      return
    }
    try {
      const payload = await requestJson<AcceptanceTemplatesConfig>('/system/config/acceptance-templates', { userId })
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
        const pendingData = await requestJson<PendingAcceptance[]>('/deliverables/pending-acceptance/mine', { userId })
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
      setError(err instanceof Error ? err.message : 'Failed to load execution data')
    }
  }, [canAccept, canConfirmReward, userId])

  useEffect(() => {
    void load()
    void loadTemplates()
  }, [load, loadTemplates])

  useEffect(() => {
    if (deliverableClaimOptions.length === 0) {
      setClaimId('')
      return
    }
    if (!deliverableClaimOptions.some((item) => String(item.claim_id) === claimId)) {
      setClaimId(String(deliverableClaimOptions[0].claim_id))
    }
  }, [claimId, deliverableClaimOptions])

  const submitDeliverable = async (event: FormEvent) => {
    event.preventDefault()
    const parsedClaimId = Number(claimId)
    if (!Number.isInteger(parsedClaimId) || parsedClaimId <= 0) {
      setError('Please select a valid claim')
      return
    }

    try {
      setError(null)
      const evidenceAttachmentIds = uploadedAttachments.map((item) => item.id)
      await requestJson(`/claims/${parsedClaimId}/deliverables`, {
        method: 'POST',
        userId,
        body: {
          summary,
          criteria_results: ['Submitted from execution loop'],
          evidence_attachment_ids: evidenceAttachmentIds,
          evidence_urls: [],
        },
      })
      setMessage('Deliverable submitted')
      setClaimId('')
      setSummary('')
      setUploadedAttachments([])
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deliverable submission failed')
    }
  }

  const openDetail = async (targetClaimId: number) => {
    try {
      setError(null)
      const payload = await requestJson<ClaimExecutionDetail>(`/claims/${targetClaimId}/detail`, { userId })
      setDetail(payload)
      setDetailOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load detail')
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
      setMessage(`Acceptance submitted: ${formatAcceptanceResult(draft.result)}`)
      setActiveAcceptanceId(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Acceptance submit failed')
    }
  }

  const confirmReward = async (rewardId: number) => {
    try {
      await requestJson(`/rewards/${rewardId}/confirm`, {
        method: 'POST',
        userId,
      })
      setMessage(`Reward #${rewardId} confirmed`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reward confirm failed')
    }
  }

  const abandonClaim = async (targetClaimId: number) => {
    const ok = window.confirm(`确认放弃揭榜 #${targetClaimId} 吗？该操作不可撤销。`)
    if (!ok) {
      return
    }
    try {
      await requestJson(`/claims/${targetClaimId}/abandon`, {
        method: 'POST',
        userId,
      })
      setMessage(`Claim #${targetClaimId} abandoned`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Abandon claim failed')
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
      setError('Each result type needs at least one template')
      return
    }

    try {
      setSavingTemplates(true)
      setError(null)
      const result = await requestJson<AcceptanceTemplatesConfig>('/system/config/acceptance-templates', {
        method: 'PUT',
        userId,
        body: payload,
      })
      const normalized = normalizeTemplates(result)
      setTemplates(normalized)
      setTemplateDraft(templatesToDraft(normalized))
      setMessage('Templates updated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Template save failed')
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
        <h2>Execution Loop</h2>
        <p>Track claims, submit deliverables, perform acceptance, and confirm rewards.</p>
      </header>

      {canManageTemplates && (
        <article className="panel form-grid">
          <h3>Acceptance Templates</h3>
          <label className="wide">
            Approved templates (one per line)
            <textarea
              value={templateDraft.approved}
              onChange={(event) => setTemplateDraft((prev) => ({ ...prev, approved: event.target.value }))}
            />
          </label>
          <label className="wide">
            Rework templates (one per line)
            <textarea
              value={templateDraft.rework}
              onChange={(event) => setTemplateDraft((prev) => ({ ...prev, rework: event.target.value }))}
            />
          </label>
          <label className="wide">
            Rejected templates (one per line)
            <textarea
              value={templateDraft.rejected}
              onChange={(event) => setTemplateDraft((prev) => ({ ...prev, rejected: event.target.value }))}
            />
          </label>
          <button type="button" onClick={() => void saveTemplates()} disabled={savingTemplates}>
            {savingTemplates ? 'Saving...' : 'Save templates'}
          </button>
        </article>
      )}

      <article className="panel">
        <div className="panel-headline">
          <h3>My Claims</h3>
          <button type="button" onClick={() => void load()}>Refresh</button>
        </div>
        <div className="table">
          <div className="row head wide-row">
            <span>Claim</span>
            <span>Task</span>
            <span>Claim Status</span>
            <span>Task Status</span>
            <span>Deliverable Status</span>
            <span>Actions</span>
          </div>
          {claims.map((item) => (
            <div className="row wide-row" key={item.claim_id}>
              <span>#{item.claim_id}</span>
              <span>{item.task_title}</span>
              <span>{formatCommonStatus(item.claim_status)}</span>
              <span>{formatCommonStatus(item.task_status)}</span>
              <span>{formatCommonStatus(item.deliverable_status)}</span>
              <span className="actions">
                <button
                  type="button"
                  onClick={() => {
                    setClaimId(String(item.claim_id))
                    void openDetail(item.claim_id)
                  }}
                >
                  Detail
                </button>
                {item.claim_status === 'active' && (
                  <button type="button" onClick={() => void abandonClaim(item.claim_id)}>
                    Abandon
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      </article>

      {canSubmitDeliverable && (
        <form className="panel form-grid" onSubmit={submitDeliverable}>
          <h3>Submit Deliverable</h3>
          <label>
            Claim
            <select value={claimId} onChange={(event) => setClaimId(event.target.value)} required>
              {deliverableClaimOptions.length === 0 && <option value="">No active claims available</option>}
              {deliverableClaimOptions.map((item) => (
                <option key={`deliverable-claim-${item.claim_id}`} value={item.claim_id}>
                  #{item.claim_id} [{formatCommonStatus(item.claim_status)}] {item.task_title}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Summary
            <textarea value={summary} onChange={(event) => setSummary(event.target.value)} required />
          </label>
          <AttachmentField
            userId={userId}
            value={uploadedAttachments}
            onChange={handleUploadedAttachmentsChange}
            label="Evidence attachments"
          />
          <button className="primary-btn" type="submit">
            Submit deliverable
          </button>
        </form>
      )}

      {canAccept && (
        <article className="panel">
          <h3>Pending Acceptance</h3>
          <div className="table">
            <div className="row head wide-row">
              <span>Deliverable</span>
              <span>Claim</span>
              <span>Task</span>
              <span>Submitter</span>
              <span>Submitted At</span>
              <span>Actions</span>
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
                        Detail
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveAcceptanceId(openEditor ? null : item.deliverable_id)}
                      >
                        {openEditor ? 'Collapse' : 'Acceptance panel'}
                      </button>
                    </span>
                  </div>
                  {openEditor && (
                    <div className="acceptance-editor">
                      <label>
                        Acceptance result
                        <select
                          value={draft.result}
                          onChange={(event) =>
                            handleResultChange(item.deliverable_id, event.target.value as AcceptanceResult)
                          }
                        >
                          <option value="approved">Approved</option>
                          <option value="rework">Rework</option>
                          <option value="rejected">Rejected</option>
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
                        Comment
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
                          Submit acceptance
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
          <h3>Reward Confirmation</h3>
          <div className="table">
            <div className="row head wide-row">
              <span>ID</span>
              <span>Task</span>
              <span>User</span>
              <span>Amount</span>
              <span>Status</span>
              <span>Actions</span>
            </div>
            {rewards.map((item) => (
              <div className="row wide-row" key={item.id}>
                <span>#{item.id}</span>
                <span>#{item.task_id}</span>
                <span>#{item.user_id}</span>
                <span>¥{item.amount.toFixed(2)}</span>
                <span>{formatCommonStatus(item.status)}</span>
                <span>
                  {item.status === 'generated' ? (
                    <button type="button" onClick={() => void confirmReward(item.id)}>
                      Confirm
                    </button>
                  ) : (
                    'Confirmed'
                  )}
                </span>
              </div>
            ))}
          </div>
        </article>
      )}

      {detailOpen && detail && (
        <div className="modal-backdrop" onClick={() => setDetailOpen(false)}>
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="claim-detail-title"
          >
            <div className="panel-headline">
              <h3 id="claim-detail-title">Claim #{detail.claim_id} Detail</h3>
              <button type="button" onClick={() => setDetailOpen(false)}>
                Close
              </button>
            </div>
            <p className="line-metric">
              <span>Task</span>
              <strong>{detail.task_title}</strong>
            </p>
            <p className="line-metric">
              <span>Goal</span>
              <strong>{detail.task_goal}</strong>
            </p>
            <p className="line-metric">
              <span>Scope</span>
              <strong>{detail.task_scope}</strong>
            </p>
            <p className="line-metric">
              <span>Status</span>
              <strong>
                {formatCommonStatus(detail.claim_status)} / {formatCommonStatus(detail.task_status)}
              </strong>
            </p>
            <p className="line-metric">
              <span>Due date</span>
              <strong>{detail.due_date}</strong>
            </p>

            <article className="modal-section">
              <h4>Acceptance Criteria</h4>
              <ul>
                {detail.acceptance_criteria.map((item, idx) => (
                  <li key={`${item.description ?? 'item'}-${idx}`}>
                    {item.description ?? 'Unnamed criterion'} ({item.type ?? 'unknown'})
                  </li>
                ))}
              </ul>
            </article>

            <article className="modal-section">
              <h4>Deliverable Summary</h4>
              <p>{detail.deliverable_summary ?? 'No deliverable yet'}</p>
              {detail.criteria_results.length > 0 && (
                <ul>
                  {detail.criteria_results.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </article>

            <article className="modal-section">
              <h4>Evidence URLs</h4>
              {detail.evidence_urls.length === 0 ? (
                <p className="muted">No evidence URLs</p>
              ) : (
                <ul>
                  {detail.evidence_urls.map((url, idx) => (
                    <li key={`${url}-${idx}`}>
                      <a href={url} target="_blank" rel="noreferrer">
                        Open evidence #{idx + 1}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="modal-section">
              <h4>Acceptance History</h4>
              {detail.acceptance_history.length === 0 ? (
                <p className="muted">No acceptance history</p>
              ) : (
                <ul>
                  {detail.acceptance_history.map((item) => (
                    <li key={item.acceptance_id}>
                      [{formatCommonStatus(item.result)}] {item.comment ?? '-'} ({new Date(item.created_at).toLocaleString()})
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
