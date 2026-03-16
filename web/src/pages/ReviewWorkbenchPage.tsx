import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { AnalysisReportView } from '../components/AnalysisReportView'
import { MilestoneEditor } from '../components/MilestoneEditor'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import { buildDefaultMilestones } from '../lib/milestoneDrafts'
import { formatProblemStatusLabel } from '../lib/enumLabels'
import { isMilestoneTaskType, resolveTaskType } from '../lib/taskType'
import type {
  BadgeDefinition,
  Problem,
  ProblemAnalysisReport,
  ProblemDetail,
  ProblemReviewResult,
  TaskType,
  TaskMilestoneDefinition,
  UserProfile,
} from '../types'

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

const pointsRangeByLevel: Record<TaskLevel, { min: number; max: number }> = {
  S: { min: 80, max: 150 },
  A: { min: 40, max: 80 },
  B: { min: 15, max: 40 },
  C: { min: 5, max: 15 },
}

const MOUNTAIN_MIN_REWARD = 100000
const MOUNTAIN_MIN_MILESTONES = 3
const MOUNTAIN_MIN_DURATION_DAYS = 180

function buildDefaultPricingDraft(): PricingDraft {
  return {
    level: 'C',
    reward_total: '600',
    proposer_ratio: '0.3',
    accepter_id: '',
    points: '5',
    badge: '',
  }
}

function problemTone(status: string): 'success' | 'warn' | 'danger' | 'info' | 'muted' {
  if (status === 'approved') return 'success'
  if (status === 'pending_review' || status === 'pricing_revision_required') return 'warn'
  if (status === 'rejected') return 'danger'
  if (status === 'draft') return 'info'
  return 'muted'
}

function normalizeMilestones(detail: ProblemDetail | null): TaskMilestoneDefinition[] {
  if (!detail?.priced_milestones || detail.priced_milestones.length === 0) {
    return buildDefaultMilestones()
  }
  const rows = detail.priced_milestones
    .map((item, index) => ({
      sequence: Number(item.sequence ?? index + 1),
      title: String(item.title ?? `里程碑 ${index + 1}`),
      goal: String(item.goal ?? ''),
      due_date: item.due_date ?? null,
      reward_ratio: Number(item.reward_ratio ?? 0),
      acceptance_criteria:
        item.acceptance_criteria && item.acceptance_criteria.length > 0
          ? item.acceptance_criteria.map((criterion) => ({
              description: String(criterion.description ?? ''),
              type: (criterion.type === 'quantified' ? 'quantified' : 'behavioral') as 'quantified' | 'behavioral',
            }))
          : [{ description: '', type: 'behavioral' as const }],
    }))
    .sort((a, b) => a.sequence - b.sequence)
  return rows.length > 0 ? rows : buildDefaultMilestones()
}

function buildMilestoneSeed(sequence: number): TaskMilestoneDefinition {
  return {
    sequence,
    title: `里程碑 ${sequence}`,
    goal: '',
    due_date: null,
    reward_ratio: 0.2,
    acceptance_criteria: [{ description: '', type: 'behavioral' }],
  }
}

function ensureMilestoneCount(
  milestones: TaskMilestoneDefinition[],
  taskType: TaskType,
): TaskMilestoneDefinition[] {
  if (!isMilestoneTaskType(taskType)) {
    return milestones
  }
  const minimum = taskType === 'mountain' ? MOUNTAIN_MIN_MILESTONES : 2
  const next = milestones.length > 0 ? [...milestones] : buildDefaultMilestones()
  while (next.length < minimum) {
    next.push(buildMilestoneSeed(next.length + 1))
  }
  return next.map((item, index) => ({ ...item, sequence: index + 1 }))
}

function minimumMountainDueDate(): string {
  const next = new Date()
  next.setHours(0, 0, 0, 0)
  next.setDate(next.getDate() + MOUNTAIN_MIN_DURATION_DAYS)
  return next.toISOString().slice(0, 10)
}

export function ReviewWorkbenchPage({ userId }: Props) {
  const toast = useToast()
  const navigate = useNavigate()
  const [pendingProblems, setPendingProblems] = useState<Problem[]>([])
  const [acceptors, setAcceptors] = useState<UserProfile[]>([])
  const [badges, setBadges] = useState<BadgeDefinition[]>([])
  const [selectedProblemId, setSelectedProblemId] = useState<number | null>(null)
  const [selectedProblemDetail, setSelectedProblemDetail] = useState<ProblemDetail | null>(null)
  const [selectedAnalysis, setSelectedAnalysis] = useState<ProblemAnalysisReport | null>(null)
  const [reviewModalOpen, setReviewModalOpen] = useState(false)
  const [reviewTab, setReviewTab] = useState<'draft' | 'analysis' | 'pricing' | 'reject'>('pricing')
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [pricingDraft, setPricingDraft] = useState<PricingDraft>(buildDefaultPricingDraft())
  const [reviewComment, setReviewComment] = useState('')
  const [analysisAcceptance, setAnalysisAcceptance] = useState('')
  const [taskType, setTaskType] = useState<TaskType>('normal')
  const [taskGoal, setTaskGoal] = useState('')
  const [taskScope, setTaskScope] = useState('')
  const [taskDueDate, setTaskDueDate] = useState('')
  const [closingRewardRatio, setClosingRewardRatio] = useState(0.4)
  const [milestones, setMilestones] = useState<TaskMilestoneDefinition[]>(buildDefaultMilestones())
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedProblem = useMemo(
    () => pendingProblems.find((item) => item.id === selectedProblemId) ?? null,
    [pendingProblems, selectedProblemId],
  )
  const milestoneTask = useMemo(() => isMilestoneTaskType(taskType), [taskType])
  const minimumMountainDate = useMemo(() => minimumMountainDueDate(), [])
  const mountainDueDateTooShort = useMemo(() => {
    if (taskType !== 'mountain' || !taskDueDate) return false
    return taskDueDate < minimumMountainDate
  }, [minimumMountainDate, taskDueDate, taskType])

  const resetReviewContext = () => {
    setSelectedProblemId(null)
    setSelectedProblemDetail(null)
    setSelectedAnalysis(null)
    setReviewComment('')
    setAnalysisAcceptance('')
    setPricingDraft(buildDefaultPricingDraft())
    setTaskType('normal')
    setTaskGoal('')
    setTaskScope('')
    setTaskDueDate('')
    setClosingRewardRatio(0.4)
    setMilestones(buildDefaultMilestones())
    setReviewModalOpen(false)
    setReviewTab('pricing')
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setError(null)
      const [pending, repricing, accepterUsers, badgeDefs] = await Promise.all([
        requestJson<Problem[]>('/problems?status=pending_review', { userId }),
        requestJson<Problem[]>('/problems?status=pricing_revision_required', { userId }),
        requestJson<UserProfile[]>('/users/acceptors', { userId }),
        requestJson<BadgeDefinition[]>('/badges', { userId }),
      ])
      setPendingProblems([...pending, ...repricing])
      setAcceptors(accepterUsers)
      setBadges(badgeDefs)
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
    setReviewModalOpen(true)
    setReviewTab('pricing')
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
      const nextTaskType = resolveTaskType(detail.priced_task_type, detail.priced_is_complex)
      setTaskType(nextTaskType)
      setTaskGoal(detail.draft_goal || '')
      setTaskScope(detail.draft_scope || '')
      setTaskDueDate(detail.draft_due_date || '')
      setClosingRewardRatio(Number(detail.priced_closing_reward_ratio ?? (nextTaskType === 'normal' ? 1 : 0.4)))
      setMilestones(ensureMilestoneCount(normalizeMilestones(detail), nextTaskType))
      if (detail.priced_level && detail.priced_reward_total) {
        setPricingDraft({
          level: detail.priced_level as TaskLevel,
          reward_total: String(detail.priced_reward_total),
          proposer_ratio: String(detail.priced_proposer_ratio ?? 0.3),
          accepter_id: String(detail.priced_accepter_id ?? ''),
          points: String(detail.priced_points ?? pointsRangeByLevel[detail.priced_level as TaskLevel].min),
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
      setMessage(`问题 #${selectedProblem.id} 已退回提报人修改`)
      resetReviewContext()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '退回失败')
    }
  }

  const submitPricingApprove = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedProblem || !selectedProblemDetail) return

    const reward = Number(pricingDraft.reward_total)
    const proposerRatio = Number(pricingDraft.proposer_ratio)
    const accepterId = Number(pricingDraft.accepter_id)
    const points = Number(pricingDraft.points || '0')
    const range = rewardRangeByLevel[pricingDraft.level]
    const pointRange = pointsRangeByLevel[pricingDraft.level]

    if (taskType === 'mountain') {
      if (pricingDraft.level !== 'S') {
        setError('山头任务必须使用 S 级')
        return
      }
      if (!Number.isFinite(reward) || reward < MOUNTAIN_MIN_REWARD) {
        setError(`山头任务奖励总额必须不低于 ${MOUNTAIN_MIN_REWARD}`)
        return
      }
    } else if (!Number.isFinite(reward) || reward < range.min || reward > range.max) {
      setError(`奖励总额需在 ${range.min}-${range.max} 区间`)
      return
    }
    if (!Number.isFinite(proposerRatio) || proposerRatio < 0.2 || proposerRatio > 0.3) {
      setError('提报人分成比例需在 0.2-0.3 之间')
      return
    }
    if (!Number.isInteger(accepterId) || accepterId <= 0) {
      setError('请选择验收人')
      return
    }
    if (!Number.isInteger(points) || points < pointRange.min || points > pointRange.max) {
      setError(`积分需在 ${pointRange.min}-${pointRange.max} 区间`)
      return
    }
    if (milestoneTask) {
      if (!taskGoal.trim() || !taskScope.trim() || !taskDueDate) {
        setError('请补全任务目标、范围和截止日期')
        return
      }
      if (taskType === 'mountain' && mountainDueDateTooShort) {
        setError(`山头任务截止日期至少需要 ${MOUNTAIN_MIN_DURATION_DAYS} 天周期`)
        return
      }
      if (taskType === 'mountain') {
        if (milestones.length < MOUNTAIN_MIN_MILESTONES) {
          setError(`山头任务至少需要 ${MOUNTAIN_MIN_MILESTONES} 个里程碑`)
          return
        }
      } else if (milestones.length < 2 || milestones.length > 5) {
        setError('复杂任务必须配置 2-5 个里程碑')
        return
      }
      const ratioSum = milestones.reduce((acc, item) => acc + Number(item.reward_ratio || 0), 0) + Number(closingRewardRatio || 0)
      if (Math.abs(ratioSum - 1) > 0.0001) {
        setError('里程碑比例与结项比例之和必须为 1')
        return
      }
    }

    try {
      setError(null)
      const commonPayload = {
        approve: true,
        analysis_id: selectedAnalysis?.id ?? null,
        analysis_acceptance: selectedAnalysis ? (analysisAcceptance.trim() || '已参考论证结果') : null,
      }
      const taskAcceptanceCriteria =
        selectedProblemDetail.draft_acceptance_criteria && selectedProblemDetail.draft_acceptance_criteria.length > 0
          ? selectedProblemDetail.draft_acceptance_criteria.map((item) => ({
              description: item.description ?? '验收项',
              type: item.type === 'quantified' ? 'quantified' : 'behavioral',
            }))
          : [{ description: '按验收标准完成交付', type: 'behavioral' as const }]

      const result = await requestJson<ProblemReviewResult>(`/problems/${selectedProblem.id}/review`, {
        method: 'POST',
        userId,
        body: milestoneTask
          ? {
              ...commonPayload,
              task: {
                title: selectedProblem.title,
                goal: taskGoal.trim(),
                scope: taskScope.trim(),
                due_date: taskDueDate,
                level: pricingDraft.level,
                reward_total: reward,
                proposer_ratio: proposerRatio,
                accepter_id: accepterId,
                points,
                badge: pricingDraft.badge.trim() || null,
                task_type: taskType,
                is_complex: milestoneTask,
                closing_reward_ratio: closingRewardRatio,
                milestones,
                acceptance_criteria: taskAcceptanceCriteria,
              },
            }
          : {
              ...commonPayload,
              pricing: {
                level: pricingDraft.level,
                reward_total: reward,
                proposer_ratio: proposerRatio,
                accepter_id: accepterId,
                points,
                badge: pricingDraft.badge.trim() || null,
                task_type: taskType,
              },
            },
      })
      if (result.status === 'budget_pending') {
        setMessage(`问题 #${selectedProblem.id} 已完成评审定价，等待资金复核`)
      } else {
        setMessage(`问题 #${selectedProblem.id} 已立项并生成任务 #${result.id}`)
      }
      resetReviewContext()
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
        <p>评审人可退回修改，或直接定价通过；复杂任务和山头任务在这里配置任务定义与里程碑。</p>
      </header>

      <article className="panel">
        <div className="panel-headline">
          <h3>待评审问题（{pendingProblems.length}）</h3>
          <button type="button" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
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
          {pendingProblems.length === 0 && (
            <div className="row wide-row">
              <span style={{ gridColumn: '1 / -1', textAlign: 'center' }}>当前没有待评审问题</span>
            </div>
          )}
          {pendingProblems.map((item) => (
            <div className="row wide-row" key={item.id}>
              <span>#{item.id}</span>
              <span>{item.title}</span>
              <span>
                <StatusBadge tone={problemTone(item.status)}>{formatProblemStatusLabel(item.status)}</StatusBadge>
              </span>
              <span>{item.submitter_name || `#${item.submitter_id}`}</span>
              <span>{new Date(item.created_at).toLocaleString()}</span>
              <span className="actions">
                <button type="button" onClick={() => void pickProblem(item)}>
                  {selectedProblemId === item.id && reviewModalOpen ? '评审中' : '进入评审'}
                </button>
              </span>
            </div>
          ))}
        </div>
      </article>
      {reviewModalOpen && selectedProblem && (
        <div className="modal-backdrop" onClick={resetReviewContext}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="review-modal-title">
            <div className="panel-headline">
              <h3 id="review-modal-title">问题 #{selectedProblem.id} 评审</h3>
              <button type="button" onClick={resetReviewContext}>关闭</button>
            </div>
            <p className="muted">{selectedProblem.title}</p>
            {analysisLoading || !selectedProblemDetail ? (
              <p>加载中...</p>
            ) : (
              <>
                <div className="button-row">
                  <button type="button" onClick={() => setReviewTab('draft')} disabled={reviewTab === 'draft'}>任务定义</button>
                  <button type="button" onClick={() => setReviewTab('analysis')} disabled={reviewTab === 'analysis'}>论证参考</button>
                  <button type="button" onClick={() => setReviewTab('pricing')} disabled={reviewTab === 'pricing'}>评审定价</button>
                  <button type="button" onClick={() => setReviewTab('reject')} disabled={reviewTab === 'reject'}>退回修改</button>
                </div>
                {reviewTab === 'draft' && (
                  <article className="modal-section">
                    <h4>提交人任务定义</h4>
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
                  </article>
                )}
                {reviewTab === 'analysis' && (
                  <article className="modal-section">
                    <h4>ProdMind 论证参考</h4>
                    {selectedAnalysis ? (
                      <>
                        <label>
                          采纳意见（可选）
                          <textarea
                            value={analysisAcceptance}
                            onChange={(event) => setAnalysisAcceptance(event.target.value)}
                            placeholder="说明是否采纳论证结论"
                          />
                        </label>
                        <div className="button-row">
                          <button
                            type="button"
                            onClick={() => {
                              if (selectedProblem) {
                                navigate(`/hypothesis?problemId=${selectedProblem.id}`)
                              }
                            }}
                          >
                            进入假设验证
                          </button>
                        </div>
                        <AnalysisReportView analysis={selectedAnalysis} />
                      </>
                    ) : selectedProblemDetail.analysis_status === 'analyzing' ? (
                      <p>论证进行中，请稍后刷新。</p>
                    ) : selectedProblemDetail.analysis_status === 'failed' ? (
                      <p>论证失败，可重新触发。</p>
                    ) : (
                      <p>暂无可用论证结果。</p>
                    )}
                  </article>
                )}
                {reviewTab === 'pricing' && (
                  <form className="form-grid" onSubmit={submitPricingApprove}>
                    <h4>评审定价</h4>
                    <label>
                      任务类型
                      <select
                        value={taskType}
                        onChange={(event) => {
                          const nextTaskType = event.target.value as TaskType
                          setTaskType(nextTaskType)
                          setMilestones((prev) => ensureMilestoneCount(prev, nextTaskType))
                          setClosingRewardRatio((prev) => {
                            if (nextTaskType === 'normal') return 1
                            return prev === 1 ? 0.4 : prev
                          })
                          setPricingDraft((prev) => {
                            if (nextTaskType !== 'mountain') {
                              return prev
                            }
                            const nextPoints =
                              Number(prev.points) < pointsRangeByLevel.S.min || Number(prev.points) > pointsRangeByLevel.S.max
                                ? String(pointsRangeByLevel.S.min)
                                : prev.points
                            const nextReward =
                              Number(prev.reward_total) < MOUNTAIN_MIN_REWARD
                                ? String(MOUNTAIN_MIN_REWARD)
                                : prev.reward_total
                            return {
                              ...prev,
                              level: 'S',
                              reward_total: nextReward,
                              points: nextPoints,
                            }
                          })
                          if (nextTaskType === 'mountain' && (!taskDueDate || taskDueDate < minimumMountainDate)) {
                            setTaskDueDate(minimumMountainDate)
                          }
                        }}
                      >
                        <option value="normal">普通任务</option>
                        <option value="complex">复杂任务</option>
                        <option value="mountain">山头任务</option>
                      </select>
                    </label>
                    <label>
                      任务等级
                      <select
                        value={pricingDraft.level}
                        disabled={taskType === 'mountain'}
                        onChange={(event) => {
                          const level = event.target.value as TaskLevel
                          const range = rewardRangeByLevel[level]
                          const pointRange = pointsRangeByLevel[level]
                          setPricingDraft((prev) => ({
                            ...prev,
                            level,
                            reward_total:
                              Number(prev.reward_total) < range.min || Number(prev.reward_total) > range.max
                                ? String(range.min)
                                : prev.reward_total,
                            points:
                              Number(prev.points) < pointRange.min || Number(prev.points) > pointRange.max
                                ? String(pointRange.min)
                                : prev.points,
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
                      <input
                        type="number"
                        value={pricingDraft.reward_total}
                        onChange={(event) => setPricingDraft((prev) => ({ ...prev, reward_total: event.target.value }))}
                        required
                      />
                    </label>
                    <label>
                      提报人分成比例（0.2-0.3）
                      <input
                        type="number"
                        min="0.2"
                        max="0.3"
                        step="0.01"
                        value={pricingDraft.proposer_ratio}
                        onChange={(event) => setPricingDraft((prev) => ({ ...prev, proposer_ratio: event.target.value }))}
                        required
                      />
                    </label>
                    <label>
                      验收人
                      <select
                        value={pricingDraft.accepter_id}
                        onChange={(event) => setPricingDraft((prev) => ({ ...prev, accepter_id: event.target.value }))}
                        required
                      >
                        <option value="">请选择</option>
                        {acceptors.map((item) => (
                          <option key={item.id} value={item.id}>
                            #{item.id} {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      积分
                      <input
                        type="number"
                        value={pricingDraft.points}
                        onChange={(event) => setPricingDraft((prev) => ({ ...prev, points: event.target.value }))}
                      />
                      <small className="muted">
                        当前等级积分区间：{pointsRangeByLevel[pricingDraft.level].min}-{pointsRangeByLevel[pricingDraft.level].max}
                      </small>
                    </label>
                    <label>
                      徽章（可选）
                      <select
                        value={pricingDraft.badge}
                        onChange={(event) => setPricingDraft((prev) => ({ ...prev, badge: event.target.value }))}
                      >
                        <option value="">不授予</option>
                        {badges.map((badge) => (
                          <option key={badge.code} value={badge.code}>
                            {badge.name} ({badge.code})
                          </option>
                        ))}
                      </select>
                    </label>
                    {taskType === 'mountain' && (
                      <p className="wide muted">
                        山头任务要求：奖励不低于 {MOUNTAIN_MIN_REWARD}，最短周期 {MOUNTAIN_MIN_DURATION_DAYS} 天，至少 {MOUNTAIN_MIN_MILESTONES} 个里程碑。
                      </p>
                    )}
                    {milestoneTask && (
                      <>
                        <label className="wide">
                          任务目标
                          <textarea value={taskGoal} onChange={(event) => setTaskGoal(event.target.value)} required />
                        </label>
                        <label className="wide">
                          任务范围
                          <textarea value={taskScope} onChange={(event) => setTaskScope(event.target.value)} required />
                        </label>
                        <label>
                          截止日期
                          <input type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} required />
                        </label>
                        {taskType === 'mountain' && mountainDueDateTooShort && (
                          <p className="wide muted">山头任务截止日期需不早于 {minimumMountainDate}。</p>
                        )}
                        <div className="wide">
                          <MilestoneEditor
                            value={milestones}
                            onChange={setMilestones}
                            closingRewardRatio={closingRewardRatio}
                            onClosingRewardRatioChange={setClosingRewardRatio}
                          />
                        </div>
                      </>
                    )}
                    <div className="button-row wide">
                      <button type="button" onClick={resetReviewContext}>取消</button>
                      <button className="primary-btn" type="submit">
                        通过并提交定价
                      </button>
                    </div>
                  </form>
                )}
                {reviewTab === 'reject' && (
                  <form className="form-grid" onSubmit={submitRequestChanges}>
                    <h4>退回修改</h4>
                    <label className="wide">
                      修改意见
                      <textarea value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} required />
                    </label>
                    <div className="button-row wide">
                      <button type="button" onClick={resetReviewContext}>取消</button>
                      <button type="submit">退回提报人</button>
                    </div>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
