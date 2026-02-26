import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { Problem, ProblemAnalysisReport, ProblemDetail, ProblemReviewResult, UserProfile } from '../types'

type Props = {
  userId: number
}

type TaskLevel = 'S' | 'A' | 'B' | 'C'

type PricingDraft = {
  level: TaskLevel
  reward_total: string
  proposer_ratio: string
  accepter_id: string
  points: string
  badge: string
}

const rewardRangeByLevel: Record<TaskLevel, { min: number; max: number }> = {
  S: { min: 8000, max: 15000 },
  A: { min: 3000, max: 8000 },
  B: { min: 1000, max: 3000 },
  C: { min: 200, max: 1000 },
}

function buildDefaultPricingDraft(): PricingDraft {
  return {
    level: 'C',
    reward_total: '600',
    proposer_ratio: '0.3',
    accepter_id: '',
    points: '0',
    badge: '',
  }
}

export function ReviewWorkbenchPage({ userId }: Props) {
  const toast = useToast()
  const [pendingProblems, setPendingProblems] = useState<Problem[]>([])
  const [acceptors, setAcceptors] = useState<UserProfile[]>([])
  const [selectedProblemId, setSelectedProblemId] = useState<number | null>(null)
  const [selectedProblemDetail, setSelectedProblemDetail] = useState<ProblemDetail | null>(null)
  const [selectedAnalysis, setSelectedAnalysis] = useState<ProblemAnalysisReport | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [pricingDraft, setPricingDraft] = useState<PricingDraft>(buildDefaultPricingDraft())
  const [reviewComment, setReviewComment] = useState('')
  const [analysisAcceptance, setAnalysisAcceptance] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedProblem = useMemo(
    () => pendingProblems.find((item) => item.id === selectedProblemId) ?? null,
    [pendingProblems, selectedProblemId],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setError(null)
      const [pending, repricing, accepterUsers] = await Promise.all([
        requestJson<Problem[]>('/problems?status=pending_review', { userId }),
        requestJson<Problem[]>('/problems?status=pricing_revision_required', { userId }),
        requestJson<UserProfile[]>('/users/acceptors', { userId }),
      ])
      setPendingProblems([...pending, ...repricing])
      setAcceptors(accepterUsers)
      setPricingDraft((prev) => {
        if (prev.accepter_id || accepterUsers.length === 0) return prev
        return { ...prev, accepter_id: String(accepterUsers[0].id) }
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载审核工作台失败')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  const pickProblem = async (problem: Problem) => {
    setSelectedProblemId(problem.id)
    setReviewComment('')
    setAnalysisAcceptance('')
    setSelectedAnalysis(null)
    setSelectedProblemDetail(null)
    setAnalysisLoading(true)
    try {
      const [detail, analysis] = await Promise.all([
        requestJson<ProblemDetail>(`/problems/${problem.id}`, { userId }),
        requestJson<ProblemAnalysisReport>(`/problems/${problem.id}/analysis`, { userId }).catch(() => null),
      ])
      setSelectedProblemDetail(detail)
      setSelectedAnalysis(analysis)
      if (detail.priced_level && detail.priced_reward_total) {
        setPricingDraft({
          level: detail.priced_level as TaskLevel,
          reward_total: String(detail.priced_reward_total),
          proposer_ratio: String(detail.priced_proposer_ratio ?? 0.3),
          accepter_id: String(detail.priced_accepter_id ?? ''),
          points: String(detail.priced_points ?? 0),
          badge: detail.priced_badge ?? '',
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载问题详情失败')
    } finally {
      setAnalysisLoading(false)
    }
  }

  const submitRequestChanges = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedProblem) return
    if (!reviewComment.trim()) {
      setError('请填写修改意见')
      return
    }

    try {
      setError(null)
      await requestJson(`/problems/${selectedProblem.id}/review`, {
        method: 'POST',
        userId,
        body: {
          approve: false,
          review_comment: reviewComment.trim(),
        },
      })
      setMessage(`问题 #${selectedProblem.id} 已退回提交人修改`)
      setSelectedProblemId(null)
      setSelectedProblemDetail(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '退回失败')
    }
  }

  const submitPricingApprove = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedProblem) return

    const reward = Number(pricingDraft.reward_total)
    const proposerRatio = Number(pricingDraft.proposer_ratio)
    const accepterId = Number(pricingDraft.accepter_id)
    const points = Number(pricingDraft.points || '0')
    const range = rewardRangeByLevel[pricingDraft.level]

    if (!Number.isFinite(reward) || reward < range.min || reward > range.max) {
      setError(`奖励总额需在 ${range.min}-${range.max} 区间`)
      return
    }
    if (!Number.isFinite(proposerRatio) || proposerRatio < 0.2 || proposerRatio > 0.3) {
      setError('问题提出人分成比例需在 0.2-0.3 之间')
      return
    }
    if (!Number.isInteger(accepterId) || accepterId <= 0) {
      setError('请选择验收人')
      return
    }

    try {
      setError(null)
      const result = await requestJson<ProblemReviewResult>(`/problems/${selectedProblem.id}/review`, {
        method: 'POST',
        userId,
        body: {
          approve: true,
          analysis_id: selectedAnalysis?.id ?? null,
          analysis_acceptance: selectedAnalysis ? (analysisAcceptance.trim() || '已参考论证') : null,
          pricing: {
            level: pricingDraft.level,
            reward_total: reward,
            proposer_ratio: proposerRatio,
            accepter_id: accepterId,
            points: Number.isFinite(points) ? points : 0,
            badge: pricingDraft.badge.trim() || null,
          },
        },
      })
      if (result.status === 'budget_pending') {
        setMessage(`问题 #${selectedProblem.id} 已完成评审定价，等待资金复核`)
      } else {
        setMessage(`问题 #${selectedProblem.id} 已立项并生成任务 #${result.id}`)
      }
      setSelectedProblemId(null)
      setSelectedProblemDetail(null)
      setPricingDraft(buildDefaultPricingDraft())
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '定价审核失败')
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
        <h2>问题评审与定价</h2>
        <p>评审人不改任务定义，只做通过/退回与定级定价。</p>
      </header>

      <article className="panel">
        <div className="panel-headline">
          <h3>待评审问题（{pendingProblems.length}）</h3>
          <button type="button" onClick={() => void load()} disabled={loading}>刷新</button>
        </div>
        <div className="table">
          <div className="row head wide-row">
            <span>ID</span>
            <span>标题</span>
            <span>状态</span>
            <span>提交人</span>
            <span>提交时间</span>
            <span>操作</span>
          </div>
          {pendingProblems.map((item) => (
            <div className="row wide-row" key={item.id}>
              <span>#{item.id}</span>
              <span>{item.title}</span>
              <span>{item.status}</span>
              <span>{item.submitter_name || `#${item.submitter_id}`}</span>
              <span>{new Date(item.created_at).toLocaleString()}</span>
              <span className="actions">
                <button type="button" onClick={() => void pickProblem(item)}>
                  {selectedProblemId === item.id ? '已选中' : '查看'}
                </button>
              </span>
            </div>
          ))}
        </div>
      </article>

      {selectedProblem && selectedProblemDetail && (
        <>
          <article className="panel">
            <h3>提交人任务定义（问题 #{selectedProblem.id}）</h3>
            {analysisLoading ? (
              <p>加载中...</p>
            ) : (
              <>
                <p><strong>目标：</strong>{selectedProblemDetail.draft_goal || '-'}</p>
                <p><strong>范围：</strong>{selectedProblemDetail.draft_scope || '-'}</p>
                <p><strong>截止日期：</strong>{selectedProblemDetail.draft_due_date || '-'}</p>
                <p><strong>自我复盘：</strong>{selectedProblemDetail.submitter_reflection || '-'}</p>
                <div>
                  <strong>验收标准：</strong>
                  <ul>
                    {(selectedProblemDetail.draft_acceptance_criteria ?? []).map((item, idx) => (
                      <li key={`${idx}-${item.description ?? 'item'}`}>
                        {item.description ?? '未命名'} ({item.type ?? '未知'})
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </article>

          <article className="panel">
            <h3>ProdMind 论证参考</h3>
            {selectedAnalysis ? (
              <>
                <p>建议：{selectedAnalysis.recommendation || '未提供'}
                  {selectedAnalysis.confidence ? `（置信度 ${Math.round(selectedAnalysis.confidence * 100)}%）` : ''}
                </p>
                <label>
                  对论证建议采纳意见（可选）
                  <textarea
                    value={analysisAcceptance}
                    onChange={(event) => setAnalysisAcceptance(event.target.value)}
                    placeholder="说明你采纳/不采纳的理由"
                  />
                </label>
              </>
            ) : (
              <p>暂无可用论证结果</p>
            )}
          </article>

          <form className="panel form-grid" onSubmit={submitPricingApprove}>
            <h3>评审定价</h3>
            <label>
              任务等级
              <select
                value={pricingDraft.level}
                onChange={(event) => {
                  const level = event.target.value as TaskLevel
                  const range = rewardRangeByLevel[level]
                  setPricingDraft((prev) => ({
                    ...prev,
                    level,
                    reward_total:
                      Number(prev.reward_total) < range.min || Number(prev.reward_total) > range.max
                        ? String(range.min)
                        : prev.reward_total,
                  }))
                }}
              >
                <option value="S">S</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
              </select>
            </label>
            <label>
              奖励总额
              <input type="number" value={pricingDraft.reward_total} onChange={(e) => setPricingDraft((p) => ({ ...p, reward_total: e.target.value }))} required />
            </label>
            <label>
              提交人分成比例（0.2-0.3）
              <input type="number" min="0.2" max="0.3" step="0.01" value={pricingDraft.proposer_ratio} onChange={(e) => setPricingDraft((p) => ({ ...p, proposer_ratio: e.target.value }))} required />
            </label>
            <label>
              验收人
              <select value={pricingDraft.accepter_id} onChange={(e) => setPricingDraft((p) => ({ ...p, accepter_id: e.target.value }))} required>
                <option value="">请选择</option>
                {acceptors.map((item) => (
                  <option key={item.id} value={item.id}>#{item.id} {item.name}</option>
                ))}
              </select>
            </label>
            <label>
              积分
              <input type="number" value={pricingDraft.points} onChange={(e) => setPricingDraft((p) => ({ ...p, points: e.target.value }))} />
            </label>
            <label>
              徽章（可选）
              <input value={pricingDraft.badge} onChange={(e) => setPricingDraft((p) => ({ ...p, badge: e.target.value }))} />
            </label>
            <button className="primary-btn" type="submit">通过并提交定价</button>
          </form>

          <form className="panel form-grid" onSubmit={submitRequestChanges}>
            <h3>退回修改</h3>
            <label className="wide">
              修改意见
              <textarea value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} required />
            </label>
            <button type="submit">退回提交人</button>
          </form>
        </>
      )}
    </section>
  )
}
