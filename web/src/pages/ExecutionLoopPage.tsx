import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { AttachmentField } from '../components/AttachmentField'
import { useToast } from '../components/ToastProvider'
import { downloadFile, requestJson } from '../lib/http'
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

const defaultTemplates: AcceptanceTemplatesConfig = {
  approved: ['验收通过：交付物满足验收标准。'],
  rework: ['需整改：请补充证据并重新提交。'],
  rejected: ['验收不通过：核心验收标准未满足。'],
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

function defaultComment(templates: AcceptanceTemplatesConfig, result: AcceptanceResult) {
  return templates[result][0] ?? ''
}

function formatAcceptanceResult(result: AcceptanceResult) {
  if (result === 'approved') {
    return '通过'
  }
  if (result === 'rework') {
    return '整改'
  }
  return '不通过'
}

function formatCommonStatus(status: string | null | undefined) {
  if (!status) {
    return '-'
  }

  const map: Record<string, string> = {
    active: '进行中',
    in_progress: '执行中',
    submitted: '已提交',
    approved: '通过',
    rework: '待整改',
    rejected: '不通过',
    generated: '待确认',
    confirmed: '已确认',
    completed: '已完成',
    abandoned: '已放弃',
  }

  return map[status] ?? status
}

export function ExecutionLoopPage({ userId, profile }: Props) {
  const toast = useToast()
  const [claims, setClaims] = useState<ClaimExecution[]>([])
  const [pendingAcceptance, setPendingAcceptance] = useState<PendingAcceptance[]>([])
  const [rewards, setRewards] = useState<Reward[]>([])
  const [submitPanelOpen, setSubmitPanelOpen] = useState(true)
  const [acceptancePanelOpen, setAcceptancePanelOpen] = useState(true)
  const [rewardPanelOpen, setRewardPanelOpen] = useState(true)
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
  const deliverableClaimOptions = useMemo(
    () =>
      claims
        .filter((item) => item.claim_status === 'active')
        .sort((a, b) => b.claim_id - a.claim_id),
    [claims],
  )
  const pendingGeneratedRewards = useMemo(
    () => rewards.filter((item) => item.status === 'generated').length,
    [rewards],
  )

  const handleUploadedAttachmentsChange = (next: Attachment[]) => {
    setUploadedAttachments(next)
  }

  const openEvidence = async (url: string, idx: number) => {
    try {
      setError(null)
      if (/^https?:\/\//i.test(url) && !url.includes('/attachments/')) {
        window.open(url, '_blank', 'noopener,noreferrer')
        return
      }
      await downloadFile(url, `evidence-${idx + 1}`, { userId })
    } catch (err) {
      setError(err instanceof Error ? err.message : '打开证据失败')
    }
  }

  const loadTemplates = useCallback(async () => {
    if (!canAccept) {
      setTemplates(defaultTemplates)
      return
    }
    try {
      const payload = await requestJson<AcceptanceTemplatesConfig>('/system/config/acceptance-templates', { userId })
      const normalized = normalizeTemplates(payload)
      setTemplates(normalized)
    } catch {
      setTemplates(defaultTemplates)
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
      setError(err instanceof Error ? err.message : '加载执行数据失败')
    }
  }, [canAccept, canConfirmReward, userId])

  useEffect(() => {
    void load()
    void loadTemplates()
  }, [load, loadTemplates])

  useEffect(() => {
    if (deliverableClaimOptions.length === 0) {
      setClaimId('')
    } else if (!deliverableClaimOptions.some((item) => String(item.claim_id) === claimId)) {
      setClaimId(String(deliverableClaimOptions[0].claim_id))
    }
  }, [claimId, deliverableClaimOptions])

  useEffect(() => {
    setSubmitPanelOpen(deliverableClaimOptions.length > 0)
  }, [deliverableClaimOptions.length])

  useEffect(() => {
    setAcceptancePanelOpen(pendingAcceptance.length > 0)
  }, [pendingAcceptance.length])

  useEffect(() => {
    setRewardPanelOpen(pendingGeneratedRewards > 0)
  }, [pendingGeneratedRewards])

  const submitDeliverable = async (event: FormEvent) => {
    event.preventDefault()
    const parsedClaimId = Number(claimId)
    if (!Number.isInteger(parsedClaimId) || parsedClaimId <= 0) {
      setError('请选择有效的揭榜记录')
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
          criteria_results: ['由执行闭环页面提交'],
          evidence_attachment_ids: evidenceAttachmentIds,
          evidence_urls: [],
        },
      })
      setMessage('成果已提交')
      setClaimId('')
      setSummary('')
      setUploadedAttachments([])
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '成果提交失败')
    }
  }

  const openDetail = async (targetClaimId: number) => {
    try {
      setError(null)
      const payload = await requestJson<ClaimExecutionDetail>(`/claims/${targetClaimId}/detail`, { userId })
      setDetail(payload)
      setDetailOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载详情失败')
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
      setMessage(`验收已提交：${formatAcceptanceResult(draft.result)}`)
      setActiveAcceptanceId(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交验收失败')
    }
  }

  const confirmReward = async (rewardId: number) => {
    try {
      await requestJson(`/rewards/${rewardId}/confirm`, {
        method: 'POST',
        userId,
      })
      setMessage(`奖励 #${rewardId} 已确认`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '奖励确认失败')
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
      setMessage(`揭榜 #${targetClaimId} 已放弃`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '放弃揭榜失败')
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
        <p>本页只做执行与闭环，不做系统设置。验收模板由管理员在「系统配置」统一维护。</p>
      </header>

      <article className="panel">
        <h3>角色分工</h3>
        <p className="muted">揭榜人：在“我的揭榜”提交成果。验收人/管理员：在“待验收成果”完成验收。审核人/管理员：在“奖励确认”完成确认。</p>
      </article>

      <article className="panel">
        <div className="panel-headline">
          <h3>我的揭榜</h3>
          <button type="button" onClick={() => void load()}>刷新</button>
        </div>
        <div className="table">
          <div className="row head wide-row">
            <span>揭榜</span>
            <span>任务</span>
            <span>揭榜状态</span>
            <span>任务状态</span>
            <span>成果状态</span>
            <span>操作</span>
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
                  详情
                </button>
                {item.claim_status === 'active' && (
                  <button type="button" onClick={() => void abandonClaim(item.claim_id)}>
                    放弃
                  </button>
                )}
              </span>
            </div>
          ))}
          {claims.length === 0 && <p className="muted">暂无揭榜记录</p>}
        </div>
      </article>

      {canSubmitDeliverable && (
        <article className="panel">
          <div className="panel-headline">
            <h3>提交成果</h3>
            <span className="actions">
              <span className="muted">待提交 {deliverableClaimOptions.length}</span>
              <button type="button" onClick={() => setSubmitPanelOpen((prev) => !prev)}>
                {submitPanelOpen ? '收起' : '展开'}
              </button>
            </span>
          </div>
          {submitPanelOpen ? (
            deliverableClaimOptions.length === 0 ? (
              <p className="muted">暂无可提交的进行中揭榜，已自动收起该区域。</p>
            ) : (
              <form className="form-grid" onSubmit={submitDeliverable}>
                <label>
                  揭榜
                  <select value={claimId} onChange={(event) => setClaimId(event.target.value)} required>
                    {deliverableClaimOptions.map((item) => (
                      <option key={`deliverable-claim-${item.claim_id}`} value={item.claim_id}>
                        #{item.claim_id} [{formatCommonStatus(item.claim_status)}] {item.task_title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="wide">
                  成果说明
                  <textarea value={summary} onChange={(event) => setSummary(event.target.value)} required />
                </label>
                <AttachmentField
                  userId={userId}
                  value={uploadedAttachments}
                  onChange={handleUploadedAttachmentsChange}
                  label="证据附件"
                />
                <button className="primary-btn" type="submit">
                  提交成果
                </button>
              </form>
            )
          ) : (
            <p className="muted">当前区域已收起。</p>
          )}
        </article>
      )}

      {canAccept && (
        <article className="panel">
          <div className="panel-headline">
            <h3>待验收成果</h3>
            <span className="actions">
              <span className="muted">待处理 {pendingAcceptance.length}</span>
              <button type="button" onClick={() => setAcceptancePanelOpen((prev) => !prev)}>
                {acceptancePanelOpen ? '收起' : '展开'}
              </button>
            </span>
          </div>
          {acceptancePanelOpen ? (
            <>
              <p className="muted">验收意见可直接手填，也可点模板建议快速填入。模板内容在「系统配置」维护。</p>
              <div className="table">
                <div className="row head wide-row">
                  <span>成果</span>
                  <span>揭榜</span>
                  <span>任务</span>
                  <span>提交人</span>
                  <span>提交时间</span>
                  <span>操作</span>
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
                            详情
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveAcceptanceId(openEditor ? null : item.deliverable_id)}
                          >
                            {openEditor ? '收起' : '验收面板'}
                          </button>
                        </span>
                      </div>
                      {openEditor && (
                        <div className="acceptance-editor">
                          <label>
                            验收结果
                            <select
                              value={draft.result}
                              onChange={(event) =>
                                handleResultChange(item.deliverable_id, event.target.value as AcceptanceResult)
                              }
                            >
                              <option value="approved">通过</option>
                              <option value="rework">整改</option>
                              <option value="rejected">不通过</option>
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
                            验收意见
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
                              提交验收
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                {pendingAcceptance.length === 0 && <p className="muted">暂无待验收成果，已自动收起该区域。</p>}
              </div>
            </>
          ) : (
            <p className="muted">当前区域已收起。</p>
          )}
        </article>
      )}

      {canConfirmReward && (
        <article className="panel">
          <div className="panel-headline">
            <h3>奖励确认</h3>
            <span className="actions">
              <span className="muted">待确认 {pendingGeneratedRewards}</span>
              <button type="button" onClick={() => setRewardPanelOpen((prev) => !prev)}>
                {rewardPanelOpen ? '收起' : '展开'}
              </button>
            </span>
          </div>
          {rewardPanelOpen ? (
            <div className="table">
              <div className="row head wide-row">
                <span>ID</span>
                <span>任务</span>
                <span>用户</span>
                <span>金额</span>
                <span>状态</span>
                <span>操作</span>
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
                        确认
                      </button>
                    ) : (
                      '已确认'
                    )}
                  </span>
                </div>
              ))}
              {rewards.length === 0 && <p className="muted">暂无奖励记录，已自动收起该区域。</p>}
            </div>
          ) : (
            <p className="muted">当前区域已收起。</p>
          )}
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
              <h3 id="claim-detail-title">揭榜 #{detail.claim_id} 详情</h3>
              <button type="button" onClick={() => setDetailOpen(false)}>
                关闭
              </button>
            </div>
            <p className="line-metric">
              <span>任务</span>
              <strong>{detail.task_title}</strong>
            </p>
            <p className="line-metric">
              <span>目标</span>
              <strong>{detail.task_goal}</strong>
            </p>
            <p className="line-metric">
              <span>范围</span>
              <strong>{detail.task_scope}</strong>
            </p>
            <p className="line-metric">
              <span>状态</span>
              <strong>
                {formatCommonStatus(detail.claim_status)} / {formatCommonStatus(detail.task_status)}
              </strong>
            </p>
            <p className="line-metric">
              <span>截止日期</span>
              <strong>{detail.due_date}</strong>
            </p>

            <article className="modal-section">
              <h4>验收标准</h4>
              <ul>
                {detail.acceptance_criteria.map((item, idx) => (
                  <li key={`${item.description ?? 'item'}-${idx}`}>
                    {item.description ?? '未命名标准'}（{item.type ?? '未知类型'}）
                  </li>
                ))}
              </ul>
            </article>

            <article className="modal-section">
              <h4>成果摘要</h4>
              <p>{detail.deliverable_summary ?? '暂无成果'}</p>
              {detail.criteria_results.length > 0 && (
                <ul>
                  {detail.criteria_results.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </article>

            <article className="modal-section">
              <h4>证据链接</h4>
              {detail.evidence_urls.length === 0 ? (
                <p className="muted">暂无证据链接</p>
              ) : (
                <ul>
                  {detail.evidence_urls.map((url, idx) => (
                    <li key={`${url}-${idx}`}>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => void openEvidence(url, idx)}
                      >
                        打开证据 #{idx + 1}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="modal-section">
              <h4>验收历史</h4>
              {detail.acceptance_history.length === 0 ? (
                <p className="muted">暂无验收记录</p>
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
