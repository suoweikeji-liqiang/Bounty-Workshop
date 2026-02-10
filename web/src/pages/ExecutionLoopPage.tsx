import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import { hasAnyRole, hasRole } from '../lib/roles'
import type {
  AcceptanceTemplatesConfig,
  ClaimExecution,
  ClaimExecutionDetail,
  PendingAcceptance,
  PerformanceLevel,
  PerformanceReview,
  PerformanceReviewSignalInput,
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

type PerformanceReviewDraft = {
  has_t3_plus_task: boolean
  initial_r_level: PerformanceLevel
  signals: PerformanceReviewSignalInput
}

const defaultTemplates: AcceptanceTemplatesConfig = {
  approved: ['Accepted: delivery meets all acceptance criteria.'],
  rework: ['Needs rework: please address gaps and resubmit.'],
  rejected: ['Rejected: core acceptance criteria were not met.'],
}

const defaultPerformanceSignals: PerformanceReviewSignalInput = {
  incident_severity: 'none',
  incident_count: 0,
  missed_deadline_count: 0,
  unjustified_delay_count: 0,
  process_violation_count: 0,
  known_risk_unreported: false,
  repeated_issue_count: 0,
  critical_task_missed_without_reason: false,
  repeated_issue_without_improvement: false,
}

const defaultPerformanceReviewDraft: PerformanceReviewDraft = {
  has_t3_plus_task: false,
  initial_r_level: 'R3',
  signals: defaultPerformanceSignals,
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
    return '閫氳繃'
  }
  if (result === 'rework') {
    return '鏁存敼'
  }
  return '涓嶉€氳繃'
}

function formatCommonStatus(status: string | null | undefined) {
  if (!status) {
    return '-'
  }
  if (status === 'active') {
    return 'Active'
  }
  if (status === 'in_progress') {
    return 'In Progress'
  }
  if (status === 'submitted') {
    return 'Submitted'
  }
  if (status === 'approved') {
    return 'Approved'
  }
  if (status === 'rework') {
    return 'Needs Rework'
  }
  if (status === 'rejected') {
    return 'Rejected'
  }
  if (status === 'generated') {
    return 'Generated'
  }
  if (status === 'confirmed') {
    return 'Confirmed'
  }
  if (status === 'completed') {
    return 'Completed'
  }
  if (status === 'abandoned') {
    return 'Abandoned'
  }
  return status
}

function formatBaselineStatus(status: string | null | undefined) {
  if (!status) {
    return '-'
  }
  if (status === 'good') {
    return 'good锛堝饱璐ｈ壇濂斤級'
  }
  if (status === 'normal') {
    return 'normal锛堝瓨鍦ㄥ彲鏀硅繘椤癸級'
  }
  if (status === 'fault') {
    return 'fault锛堟槑纭け鑱岋級'
  }
  return status
}

function toNonNegativeInteger(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return 0
  }
  return Math.floor(value)
}

function toPerformanceReviewDraft(payload: ClaimExecutionDetail): PerformanceReviewDraft {
  const review = payload.performance_review
  if (!review) {
    return {
      has_t3_plus_task: defaultPerformanceReviewDraft.has_t3_plus_task,
      initial_r_level: defaultPerformanceReviewDraft.initial_r_level,
      signals: { ...defaultPerformanceReviewDraft.signals },
    }
  }
  return {
    has_t3_plus_task: review.has_t3_plus_task,
    initial_r_level: review.initial_r_level,
    signals: {
      incident_severity: review.incident_severity,
      incident_count: review.incident_count,
      missed_deadline_count: review.missed_deadline_count,
      unjustified_delay_count: review.unjustified_delay_count,
      process_violation_count: review.process_violation_count,
      known_risk_unreported: review.known_risk_unreported,
      repeated_issue_count: review.repeated_issue_count,
      critical_task_missed_without_reason: review.critical_task_missed_without_reason,
      repeated_issue_without_improvement: review.repeated_issue_without_improvement,
    },
  }
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
  const [performanceDraft, setPerformanceDraft] = useState<PerformanceReviewDraft>({
    has_t3_plus_task: defaultPerformanceReviewDraft.has_t3_plus_task,
    initial_r_level: defaultPerformanceReviewDraft.initial_r_level,
    signals: { ...defaultPerformanceReviewDraft.signals },
  })
  const [savingPerformance, setSavingPerformance] = useState(false)
  const [activeAcceptanceId, setActiveAcceptanceId] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<Record<number, AcceptanceDraft>>({})
  const [templates, setTemplates] = useState<AcceptanceTemplatesConfig>(defaultTemplates)
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft>(templatesToDraft(defaultTemplates))
  const [savingTemplates, setSavingTemplates] = useState(false)

  const canAccept = useMemo(
    () => hasAnyRole(profile, ['admin', 'acceptor']),
    [profile],
  )
  const canConfirmReward = useMemo(
    () => hasAnyRole(profile, ['admin', 'reviewer']),
    [profile],
  )
  const isAdmin = useMemo(() => hasRole(profile, 'admin'), [profile])
  const canSubmitDeliverable = useMemo(
    () =>
      Boolean(
        profile?.roles.some((role) =>
          ['employee', 'admin', 'reviewer', 'acceptor'].includes(role),
        ),
      ),
    [profile],
  )
  const canManageTemplates = useMemo(() => hasRole(profile, 'admin'), [profile])
  const canEditPerformance = useMemo(
    () => hasAnyRole(profile, ['admin', 'reviewer', 'acceptor']),
    [profile],
  )

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
      setError(err instanceof Error ? err.message : '鍔犺浇鎵ц闂幆鏁版嵁澶辫触')
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
          criteria_results: [],
          evidence_attachment_ids: evidenceAttachmentIds,
          evidence_urls: [],
        },
      })
      setMessage('鎴愭灉鎻愪氦鎴愬姛')
      setClaimId('')
      setSummary('')
      setAttachmentIds('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '鎴愭灉鎻愪氦澶辫触')
    }
  }

  const openDetail = async (targetClaimId: number) => {
    try {
      setError(null)
      const payload = await requestJson<ClaimExecutionDetail>(`/claims/${targetClaimId}/detail`, { userId })
      setDetail(payload)
      setPerformanceDraft(toPerformanceReviewDraft(payload))
      setDetailOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '鍔犺浇璇︽儏澶辫触')
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
      setMessage(`楠屾敹宸叉彁浜わ細${formatAcceptanceResult(draft.result)}`)
      setActiveAcceptanceId(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '楠屾敹鎻愪氦澶辫触')
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
      setError(err instanceof Error ? err.message : 'Reward confirmation failed')
    }
  }

  const abandonClaim = async (targetClaimId: number) => {
    try {
      await requestJson(`/claims/${targetClaimId}/abandon`, {
        method: 'POST',
        userId,
      })
      setMessage(`Claim #${targetClaimId} abandoned`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '鏀惧純鎻澶辫触')
    }
  }

  const updatePerformanceSignal = <K extends keyof PerformanceReviewSignalInput>(
    key: K,
    value: PerformanceReviewSignalInput[K],
  ) => {
    setPerformanceDraft((prev) => ({
      ...prev,
      signals: {
        ...prev.signals,
        [key]: value,
      },
    }))
  }

  const savePerformanceReview = async () => {
    if (!detail || !canEditPerformance) {
      return
    }
    const payload = {
      has_t3_plus_task: performanceDraft.has_t3_plus_task,
      initial_r_level: performanceDraft.initial_r_level,
      signals: {
        incident_severity: performanceDraft.signals.incident_severity,
        incident_count: toNonNegativeInteger(performanceDraft.signals.incident_count),
        missed_deadline_count: toNonNegativeInteger(performanceDraft.signals.missed_deadline_count),
        unjustified_delay_count: toNonNegativeInteger(performanceDraft.signals.unjustified_delay_count),
        process_violation_count: toNonNegativeInteger(performanceDraft.signals.process_violation_count),
        known_risk_unreported: performanceDraft.signals.known_risk_unreported,
        repeated_issue_count: toNonNegativeInteger(performanceDraft.signals.repeated_issue_count),
        critical_task_missed_without_reason: performanceDraft.signals.critical_task_missed_without_reason,
        repeated_issue_without_improvement: performanceDraft.signals.repeated_issue_without_improvement,
      },
    }
    try {
      setSavingPerformance(true)
      setError(null)
      const result = await requestJson<PerformanceReview>(
        `/claims/${detail.claim_id}/performance-review`,
        {
          method: 'PUT',
          userId,
          body: payload,
        },
      )
      setDetail((prev) => (prev ? { ...prev, performance_review: result } : prev))
      setMessage('Performance review saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : '缁堣瘎蹇収淇濆瓨澶辫触')
    } finally {
      setSavingPerformance(false)
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
      setError('Each result type requires at least one template')
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
      setMessage('妯℃澘鏇存柊鎴愬姛')
    } catch (err) {
      setError(err instanceof Error ? err.message : '妯℃澘淇濆瓨澶辫触')
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
        <h2>鎵ц闂幆</h2>
        <p>璺熻釜鎻鎵ц銆佹彁浜ゆ垚鏋溿€佸畬鎴愰獙鏀跺苟纭婵€鍔便€</p>
      </header>

      {canManageTemplates && (
        <article className="panel form-grid">
          <h3>楠屾敹璇勮妯℃澘閰嶇疆</h3>
          <label className="wide">
            閫氳繃妯℃澘锛堟瘡琛屼竴鏉★級
            <textarea
              value={templateDraft.approved}
              onChange={(event) =>
                setTemplateDraft((prev) => ({ ...prev, approved: event.target.value }))
              }
            />
          </label>
          <label className="wide">
            鏁存敼妯℃澘锛堟瘡琛屼竴鏉★級
            <textarea
              value={templateDraft.rework}
              onChange={(event) =>
                setTemplateDraft((prev) => ({ ...prev, rework: event.target.value }))
              }
            />
          </label>
          <label className="wide">
            涓嶉€氳繃妯℃澘锛堟瘡琛屼竴鏉★級
            <textarea
              value={templateDraft.rejected}
              onChange={(event) =>
                setTemplateDraft((prev) => ({ ...prev, rejected: event.target.value }))
              }
            />
          </label>
          <button type="button" onClick={() => void saveTemplates()} disabled={savingTemplates}>
            {savingTemplates ? '淇濆瓨涓?..' : '淇濆瓨妯℃澘'}
          </button>
        </article>
      )}

      <article className="panel">
        <div className="panel-headline">
          <h3>鎴戠殑鎻璁板綍</h3>
          <button type="button" onClick={() => void load()}>
            鍒锋柊
          </button>
        </div>
        <div className="table">
          <div className="row head wide-row">
            <span>鎻</span>
            <span>浠诲姟</span>
            <span>鎻鐘舵€</span>
            <span>浠诲姟鐘舵€</span>
            <span>鎴愭灉鐘舵€</span>
            <span>鎿嶄綔</span>
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
                  璇︽儏
                </button>
                {item.claim_status === 'active' && (
                  <button type="button" onClick={() => void abandonClaim(item.claim_id)}>
                    鏀惧純
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      </article>

      {canSubmitDeliverable && (
        <form className="panel form-grid" onSubmit={submitDeliverable}>
          <h3>鎻愪氦鎴愭灉</h3>
          <label>
            鎻 ID锛坈laim_id锛?            <input value={claimId} onChange={(event) => setClaimId(event.target.value)} required />
          </label>
          <label className="wide">
            鎴愭灉璇存槑
            <textarea value={summary} onChange={(event) => setSummary(event.target.value)} required />
          </label>
          <label className="wide">
            璇佹嵁闄勪欢 ID锛堥€楀彿鍒嗛殧锛?            <input
              value={attachmentIds}
              onChange={(event) => setAttachmentIds(event.target.value)}
              placeholder="渚嬪锛?2,13"
            />
          </label>
          <button className="primary-btn" type="submit">
            鎻愪氦鎴愭灉
          </button>
        </form>
      )}

      {canAccept && (
        <article className="panel">
          <h3>寰呮垜楠屾敹</h3>
          <div className="table">
            <div className="row head wide-row">
              <span>鎴愭灉</span>
              <span>鎻</span>
              <span>浠诲姟</span>
              <span>鎻愪氦浜</span>
              <span>鎻愪氦鏃堕棿</span>
              <span>鎿嶄綔</span>
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
                        璇︽儏
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveAcceptanceId(openEditor ? null : item.deliverable_id)}
                      >
                        {openEditor ? '鏀惰捣' : '楠屾敹闈㈡澘'}
                      </button>
                    </span>
                  </div>
                  {openEditor && (
                    <div className="acceptance-editor">
                      <label>
                        楠屾敹缁撴灉
                        <select
                          value={draft.result}
                          onChange={(event) =>
                            handleResultChange(item.deliverable_id, event.target.value as AcceptanceResult)
                          }
                        >
                          <option value="approved">閫氳繃</option>
                          <option value="rework">鏁存敼</option>
                          <option value="rejected">涓嶉€氳繃</option>
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
                        楠屾敹鎰忚
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
                          鎻愪氦楠屾敹
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
          <h3>婵€鍔辩‘璁</h3>
          <div className="table">
            <div className="row head wide-row">
              <span>ID</span>
              <span>浠诲姟</span>
              <span>鐢ㄦ埛</span>
              <span>閲戦</span>
              <span>缁堣瘎</span>
              <span>鐘舵€</span>
              <span>绛栫暐</span>
              <span>鎿嶄綔</span>
            </div>
            {rewards.map((item) => (
              <div className="row wide-row" key={item.id}>
                <span>#{item.id}</span>
                <span>#{item.task_id}</span>
                <span>#{item.user_id}</span>
                <span>楼{item.amount.toFixed(2)}</span>
                <span>
                  {item.performance_baseline_status ?? '-'} / {item.performance_final_r_level ?? '-'}
                </span>
                <span>{formatCommonStatus(item.status)}</span>
                <span>{item.hold_reason ?? '-'}</span>
                <span>
                  {item.status === 'generated' ? (
                    item.held_by_performance_policy && !isAdmin ? (
                      <span className="muted">闇€绠＄悊鍛樺鏍</span>
                    ) : (
                      <button type="button" onClick={() => void confirmReward(item.id)}>
                        纭
                      </button>
                    )
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
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="panel-headline">
              <h3>鎻 #{detail.claim_id} 璇︽儏</h3>
              <button type="button" onClick={() => setDetailOpen(false)}>
                鍏抽棴
              </button>
            </div>
            <p className="line-metric">
              <span>浠诲姟</span>
              <strong>{detail.task_title}</strong>
            </p>
            <p className="line-metric">
              <span>鐩爣</span>
              <strong>{detail.task_goal}</strong>
            </p>
            <p className="line-metric">
              <span>鑼冨洿</span>
              <strong>{detail.task_scope}</strong>
            </p>
            <p className="line-metric">
              <span>鐘舵€</span>
              <strong>
                {formatCommonStatus(detail.claim_status)} / {formatCommonStatus(detail.task_status)}
              </strong>
            </p>
            <p className="line-metric">
              <span>鎴鏃ユ湡</span>
              <strong>{detail.due_date}</strong>
            </p>

            <article className="modal-section">
              <h4>楠屾敹鏍囧噯</h4>
              <ul>
                {detail.acceptance_criteria.map((item, idx) => (
                  <li key={`${item.description ?? 'item'}-${idx}`}>
                    {item.description ?? '鏈懡鍚嶉獙鏀堕」'} ({item.type ?? '鏈煡'})
                  </li>
                ))}
              </ul>
            </article>

            <article className="modal-section">
              <h4>鎴愭灉鍐呭</h4>
              <p>{detail.deliverable_summary ?? '鏆傛棤鎴愭灉鎻愪氦'}</p>
              {detail.criteria_results.length > 0 && (
                <ul>
                  {detail.criteria_results.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </article>

            <article className="modal-section">
              <h4>璇佹嵁閾炬帴</h4>
              {detail.evidence_urls.length === 0 ? (
                <p className="muted">鏆傛棤璇佹嵁閾炬帴</p>
              ) : (
                <ul>
                  {detail.evidence_urls.map((url, idx) => (
                    <li key={`${url}-${idx}`}>
                      <a href={url} target="_blank" rel="noreferrer">
                        鎵撳紑璇佹嵁 #{idx + 1}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="modal-section">
              <h4>鍩虹灞ヨ矗缁堣瘎</h4>
              {detail.performance_review ? (
                <div>
                  <p className="line-metric">
                    <span>鍩虹灞ヨ矗鐘舵€</span>
                    <strong>{formatBaselineStatus(detail.performance_review.baseline_responsibility_status)}</strong>
                  </p>
                  <p className="line-metric">
                    <span>R 绛夌骇锛堝垵璇?{'->'} 缁堣瘎锛</span>
                    <strong>
                      {detail.performance_review.initial_r_level} {'->'} {detail.performance_review.final_r_level}
                    </strong>
                  </p>
                  {detail.performance_review.baseline_reasons.length > 0 && (
                    <ul>
                      {detail.performance_review.baseline_reasons.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                  {detail.performance_review.has_fault_warning && (
                    <p style={{ color: '#b00020', fontWeight: 700 }}>
                      瀛樺湪鍩虹灞ヨ矗澶辫亴琛屼负锛岃鐘舵€佸皢涓嬭皟鏈€缁堢哗鏁堢瓑绾с€?                    </p>
                  )}
                </div>
              ) : (
                <p className="muted">鏆傛棤缁堣瘎蹇収</p>
              )}

              {canEditPerformance && (
                <div className="form-grid">
                  <label>
                    鏄惁鏈?T3+ 浠诲姟
                    <select
                      value={performanceDraft.has_t3_plus_task ? 'yes' : 'no'}
                      onChange={(event) =>
                        setPerformanceDraft((prev) => ({
                          ...prev,
                          has_t3_plus_task: event.target.value === 'yes',
                        }))
                      }
                    >
                      <option value="no">鍚</option>
                      <option value="yes">鏄</option>
                    </select>
                  </label>
                  <label>
                    鍒濊瘎 R 绛夌骇
                    <select
                      value={performanceDraft.initial_r_level}
                      onChange={(event) =>
                        setPerformanceDraft((prev) => ({
                          ...prev,
                          initial_r_level: event.target.value as PerformanceLevel,
                        }))
                      }
                    >
                      <option value="R1">R1</option>
                      <option value="R2">R2</option>
                      <option value="R3">R3</option>
                      <option value="R4">R4</option>
                      <option value="R5">R5</option>
                    </select>
                  </label>
                  <label>
                    浜嬫晠绛夌骇
                    <select
                      value={performanceDraft.signals.incident_severity}
                      onChange={(event) => updatePerformanceSignal('incident_severity', event.target.value as PerformanceReviewSignalInput['incident_severity'])}
                    >
                      <option value="none">none</option>
                      <option value="minor">minor</option>
                      <option value="major">major</option>
                    </select>
                  </label>
                  <label>
                    浜嬫晠娆℃暟
                    <input
                      type="number"
                      min={0}
                      value={performanceDraft.signals.incident_count}
                      onChange={(event) => updatePerformanceSignal('incident_count', toNonNegativeInteger(Number(event.target.value)))}
                    />
                  </label>
                  <label>
                    鑱岃矗閬楁紡/寤舵湡娆℃暟
                    <input
                      type="number"
                      min={0}
                      value={performanceDraft.signals.missed_deadline_count}
                      onChange={(event) =>
                        updatePerformanceSignal('missed_deadline_count', toNonNegativeInteger(Number(event.target.value)))
                      }
                    />
                  </label>
                  <label>
                    鏃犵悊鐢卞欢鏈熸鏁?                    <input
                      type="number"
                      min={0}
                      value={performanceDraft.signals.unjustified_delay_count}
                      onChange={(event) =>
                        updatePerformanceSignal('unjustified_delay_count', toNonNegativeInteger(Number(event.target.value)))
                      }
                    />
                  </label>
                  <label>
                    娴佺▼杩濊娆℃暟
                    <input
                      type="number"
                      min={0}
                      value={performanceDraft.signals.process_violation_count}
                      onChange={(event) =>
                        updatePerformanceSignal('process_violation_count', toNonNegativeInteger(Number(event.target.value)))
                      }
                    />
                  </label>
                  <label>
                    閲嶅闂娆℃暟
                    <input
                      type="number"
                      min={0}
                      value={performanceDraft.signals.repeated_issue_count}
                      onChange={(event) =>
                        updatePerformanceSignal('repeated_issue_count', toNonNegativeInteger(Number(event.target.value)))
                      }
                    />
                  </label>
                  <label>
                    宸茬煡椋庨櫓鏈笂鎶?                    <input
                      type="checkbox"
                      checked={performanceDraft.signals.known_risk_unreported}
                      onChange={(event) => updatePerformanceSignal('known_risk_unreported', event.target.checked)}
                    />
                  </label>
                  <label>
                    鍏抽敭浠诲姟閬楁紡涓旀棤鐞嗙敱
                    <input
                      type="checkbox"
                      checked={performanceDraft.signals.critical_task_missed_without_reason}
                      onChange={(event) =>
                        updatePerformanceSignal('critical_task_missed_without_reason', event.target.checked)
                      }
                    />
                  </label>
                  <label>
                    閲嶅闂涓旀棤鏀硅繘
                    <input
                      type="checkbox"
                      checked={performanceDraft.signals.repeated_issue_without_improvement}
                      onChange={(event) =>
                        updatePerformanceSignal('repeated_issue_without_improvement', event.target.checked)
                      }
                    />
                  </label>
                  <button type="button" onClick={() => void savePerformanceReview()} disabled={savingPerformance}>
                    {savingPerformance ? '淇濆瓨涓?..' : '淇濆瓨缁堣瘎蹇収'}
                  </button>
                </div>
              )}
            </article>

            <article className="modal-section">
              <h4>楠屾敹鍘嗗彶</h4>
              {detail.acceptance_history.length === 0 ? (
                <p className="muted">鏆傛棤楠屾敹鍘嗗彶</p>
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

