import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { Problem, ProblemAnalysisReport, UserProfile } from '../types'

type Props = {
  userId: number
}

type TaskLevel = 'S' | 'A' | 'B' | 'C'
type CriteriaType = 'quantified' | 'behavioral'

type CriteriaDraft = {
  description: string
  type: CriteriaType
}

type TaskDraft = {
  title: string
  goal: string
  scope: string
  due_date: string
  level: TaskLevel
  reward_total: string
  proposer_ratio: string
  accepter_id: string
  points: string
  badge: string
  criteria: CriteriaDraft[]
}

const rewardRangeByLevel: Record<TaskLevel, { min: number; max: number }> = {
  S: { min: 8000, max: 15000 },
  A: { min: 3000, max: 8000 },
  B: { min: 1000, max: 3000 },
  C: { min: 200, max: 1000 },
}

function buildDefaultTaskDraft(): TaskDraft {
  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + 7)
  return {
    title: '',
    goal: '',
    scope: '',
    due_date: dueDate.toISOString().slice(0, 10),
    level: 'C',
    reward_total: '600',
    proposer_ratio: '0.3',
    accepter_id: '',
    points: '0',
    badge: '',
    criteria: [{ description: '', type: 'quantified' }],
  }
}

export function ReviewWorkbenchPage({ userId }: Props) {
  const toast = useToast()
  const [pendingProblems, setPendingProblems] = useState<Problem[]>([])
  const [acceptors, setAcceptors] = useState<UserProfile[]>([])
  const [selectedProblemId, setSelectedProblemId] = useState<number | null>(null)
  const [selectedAnalysis, setSelectedAnalysis] = useState<ProblemAnalysisReport | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(buildDefaultTaskDraft())
  const [rejectReason, setRejectReason] = useState('')
  const [mergeToProblemId, setMergeToProblemId] = useState('')
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
      const [problems, accepterUsers] = await Promise.all([
        requestJson<Problem[]>('/problems?status=pending_review', { userId }),
        requestJson<UserProfile[]>('/users/acceptors', { userId }),
      ])
      setPendingProblems(problems)
      setAcceptors(accepterUsers)
      setTaskDraft((prev) => {
        if (prev.accepter_id || accepterUsers.length === 0) {
          return prev
        }
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
    setRejectReason('')
    setMergeToProblemId('')
    setAnalysisAcceptance('')
    setSelectedAnalysis(null)
    setTaskDraft((prev) => ({
      ...prev,
      title: prev.title || `${problem.title} - 任务`,
    }))
    setAnalysisLoading(true)
    try {
      const analysis = await requestJson<ProblemAnalysisReport | null>(
        `/problems/${problem.id}/analysis`,
        { userId },
      )
      setSelectedAnalysis(analysis)
    } catch {
      setSelectedAnalysis(null)
    } finally {
      setAnalysisLoading(false)
    }
  }

  const addCriteria = () => {
    setTaskDraft((prev) => ({
      ...prev,
      criteria: [...prev.criteria, { description: '', type: 'quantified' }],
    }))
  }

  const removeCriteria = (index: number) => {
    setTaskDraft((prev) => {
      const next = prev.criteria.filter((_, idx) => idx !== index)
      return {
        ...prev,
        criteria: next.length > 0 ? next : [{ description: '', type: 'quantified' }],
      }
    })
  }

  const submitReject = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedProblem) {
      return
    }
    try {
      setError(null)
      await requestJson(`/problems/${selectedProblem.id}/review`, {
        method: 'POST',
        userId,
        body: {
          approve: false,
          reject_reason: rejectReason.trim() || '不立项',
          merge_to_problem_id: mergeToProblemId.trim() ? Number(mergeToProblemId.trim()) : null,
        },
      })
      setMessage(`问题 #${selectedProblem.id} 已驳回`)
      setSelectedProblemId(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '驳回失败')
    }
  }

  const submitApprove = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedProblem) {
      return
    }

    const reward = Number(taskDraft.reward_total)
    const proposerRatio = Number(taskDraft.proposer_ratio)
    const accepterId = Number(taskDraft.accepter_id)
    const points = Number(taskDraft.points || '0')
    const range = rewardRangeByLevel[taskDraft.level]
    const criteria = taskDraft.criteria
      .map((item) => ({ description: item.description.trim(), type: item.type }))
      .filter((item) => item.description)

    if (criteria.length === 0) {
      setError('至少填写一条验收标准')
      return
    }
    if (!Number.isFinite(reward) || reward < range.min || reward > range.max) {
      setError(`奖励总额需在 ${range.min}-${range.max} 之间`)
      return
    }
    if (!Number.isFinite(proposerRatio) || proposerRatio < 0.2 || proposerRatio > 0.3) {
      setError('问题提出人激励比例需在 0.2-0.3 之间')
      return
    }
    if (!Number.isInteger(accepterId) || accepterId <= 0) {
      setError('请选择验收人')
      return
    }
    if (!selectedAnalysis) {
      setError('请先等待 ProdMind 论证完成')
      return
    }
    if (!analysisAcceptance.trim()) {
      setError('必须填写对论证建议的采纳意见')
      return
    }

    try {
      setError(null)
      await requestJson(`/problems/${selectedProblem.id}/review`, {
        method: 'POST',
        userId,
        body: {
          approve: true,
          analysis_id: selectedAnalysis.id,
          analysis_acceptance: analysisAcceptance.trim(),
          task: {
            title: taskDraft.title.trim(),
            goal: taskDraft.goal.trim(),
            scope: taskDraft.scope.trim(),
            due_date: taskDraft.due_date,
            level: taskDraft.level,
            reward_total: reward,
            proposer_ratio: proposerRatio,
            accepter_id: accepterId,
            points: Number.isFinite(points) ? points : 0,
            badge: taskDraft.badge.trim() || null,
            acceptance_criteria: criteria,
          },
        },
      })
      setMessage(`问题 #${selectedProblem.id} 已立项`)
      setSelectedProblemId(null)
      setSelectedAnalysis(null)
      setAnalysisAcceptance('')
      setTaskDraft(buildDefaultTaskDraft())
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '立项失败')
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
        <h2>问题审核与任务定义</h2>
        <p>审核待立项问题，完成任务定义并指定验收人。</p>
      </header>

      <article className="panel">
        <div className="panel-headline">
          <h3>待审核问题（{pendingProblems.length}）</h3>
          <button type="button" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
        </div>
        <div className="table">
          <div className="row head wide-row">
            <span>ID</span>
            <span>标题</span>
            <span>场景</span>
            <span>提交人</span>
            <span>提交时间</span>
            <span>操作</span>
          </div>
          {pendingProblems.map((item) => (
            <div className="row wide-row" key={item.id}>
              <span>#{item.id}</span>
              <span>{item.title}</span>
              <span>{item.scenario}</span>
              <span>{item.submitter_name || `#${item.submitter_id}`}</span>
              <span>{new Date(item.created_at).toLocaleString()}</span>
              <span className="actions">
                <button type="button" onClick={() => pickProblem(item)}>
                  {selectedProblemId === item.id ? '已选中' : '选择'}
                </button>
              </span>
            </div>
          ))}
        </div>
      </article>

      {selectedProblem && (
        <>
          <article className="panel">
            <h3>ProdMind 论证参考（问题 #{selectedProblem.id}）</h3>
            {analysisLoading ? (
              <p>正在加载论证报告...</p>
            ) : selectedAnalysis ? (
              selectedAnalysis.status === 'failed' ? (
                <div className="no-analysis">
                  <p style={{ color: 'red' }}>论证失败：{selectedAnalysis.error_message || '未知错误'}</p>
                  <p>由于模型配置或调用失败，未能生成立项建议。您可以稍后再次尝试或手动进行立项。</p>
                </div>
              ) : selectedAnalysis.status === 'analyzing' || selectedAnalysis.status === 'pending' ? (
                <div className="no-analysis">
                  <p>正在执行 ProdMind 论证，请稍候...</p>
                </div>
              ) : (
                <div className="analysis-summary">
                  <div className="analysis-header">
                    <span className="recommendation">
                      立项建议：{selectedAnalysis.recommendation || '未提供'}
                      {selectedAnalysis.confidence ? `（置信度 ${Math.round(selectedAnalysis.confidence * 100)}%）` : ''}
                    </span>
                  </div>
                  {selectedAnalysis.report?.grounder?.hypothesis_list && selectedAnalysis.report.grounder.hypothesis_list.length > 0 && (
                    <div className="hypothesis-list">
                      <h4>假设清单</h4>
                      {selectedAnalysis.report.grounder.hypothesis_list.map((h, idx) => (
                        <div key={idx} className={`hypothesis-item risk-${h.risk_level}`}>
                          <span className="hypothesis-type">{h.hypothesis_type}</span>
                          <span className="hypothesis-risk">{h.risk_level}</span>
                          <span className="hypothesis-content">{h.content}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedAnalysis.report?.assassin?.risks_identified && selectedAnalysis.report.assassin.risks_identified.length > 0 && (
                    <div className="risks-section">
                      <h4>关键风险点</h4>
                      <ul>
                        {selectedAnalysis.report.assassin.risks_identified.map((r, idx) => (
                          <li key={idx}>
                            {r.risk}（{r.severity}）
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="no-analysis">
                <p>该问题尚未完成 ProdMind 论证</p>
              </div>
            )}
          </article>

          <form className="panel form-grid" onSubmit={submitApprove}>
            <h3>立项定义（问题 #{selectedProblem.id}）</h3>
            <label className="wide">
              任务标题
              <input
                value={taskDraft.title}
                onChange={(event) => setTaskDraft((prev) => ({ ...prev, title: event.target.value }))}
                required
              />
            </label>
            <label className="wide">
              任务目标
              <textarea
                value={taskDraft.goal}
                onChange={(event) => setTaskDraft((prev) => ({ ...prev, goal: event.target.value }))}
                required
              />
            </label>
            <label className="wide">
              范围（做什么/不做什么）
              <textarea
                value={taskDraft.scope}
                onChange={(event) => setTaskDraft((prev) => ({ ...prev, scope: event.target.value }))}
                required
              />
            </label>
            <label>
              截止日期
              <input
                type="date"
                value={taskDraft.due_date}
                onChange={(event) => setTaskDraft((prev) => ({ ...prev, due_date: event.target.value }))}
                required
              />
            </label>
            <label>
              任务等级
              <select
                value={taskDraft.level}
                onChange={(event) => {
                  const level = event.target.value as TaskLevel
                  const range = rewardRangeByLevel[level]
                  setTaskDraft((prev) => ({
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
              激励总额
              <input
                type="number"
                value={taskDraft.reward_total}
                onChange={(event) =>
                  setTaskDraft((prev) => ({ ...prev, reward_total: event.target.value }))
                }
                required
              />
            </label>
            <label>
              提出人比例（0.2-0.3）
              <input
                type="number"
                min="0.2"
                max="0.3"
                step="0.01"
                value={taskDraft.proposer_ratio}
                onChange={(event) =>
                  setTaskDraft((prev) => ({ ...prev, proposer_ratio: event.target.value }))
                }
                required
              />
            </label>
            <label>
              验收人
              <select
                value={taskDraft.accepter_id}
                onChange={(event) =>
                  setTaskDraft((prev) => ({ ...prev, accepter_id: event.target.value }))
                }
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
                value={taskDraft.points}
                onChange={(event) => setTaskDraft((prev) => ({ ...prev, points: event.target.value }))}
              />
            </label>
            <label className="wide">
              徽章（可选）
              <input
                value={taskDraft.badge}
                onChange={(event) => setTaskDraft((prev) => ({ ...prev, badge: event.target.value }))}
              />
            </label>
            <div className="wide">
              <div className="panel-headline">
                <h3>验收标准</h3>
                <button type="button" onClick={addCriteria}>
                  新增标准
                </button>
              </div>
              {taskDraft.criteria.map((item, idx) => (
                <div className="acceptance-editor" key={`criteria-${idx}`}>
                  <label>
                    描述
                    <input
                      value={item.description}
                      onChange={(event) =>
                        setTaskDraft((prev) => ({
                          ...prev,
                          criteria: prev.criteria.map((row, rowIdx) =>
                            rowIdx === idx ? { ...row, description: event.target.value } : row,
                          ),
                        }))
                      }
                    />
                  </label>
                  <label>
                    类型
                    <select
                      value={item.type}
                      onChange={(event) =>
                        setTaskDraft((prev) => ({
                          ...prev,
                          criteria: prev.criteria.map((row, rowIdx) =>
                            rowIdx === idx
                              ? { ...row, type: event.target.value as CriteriaType }
                              : row,
                          ),
                        }))
                      }
                    >
                      <option value="quantified">量化指标</option>
                      <option value="behavioral">行为指标</option>
                    </select>
                  </label>
                  <button type="button" onClick={() => removeCriteria(idx)}>
                    删除标准
                  </button>
                </div>
              ))}
            </div>
            <label className="wide">
              对论证建议的采纳意见
              <textarea
                value={analysisAcceptance}
                onChange={(event) => setAnalysisAcceptance(event.target.value)}
                placeholder="请填写对 ProdMind 论证建议的采纳意见（必填）"
                required
              />
            </label>
            <button className="primary-btn" type="submit">
              立项并生成任务
            </button>
          </form>

          <form className="panel form-grid" onSubmit={submitReject}>
            <h3>驳回问题（问题 #{selectedProblem.id}）</h3>
            <label className="wide">
              驳回原因
              <textarea
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                required
              />
            </label>
            <label>
              合并到问题 ID（可选）
              <input
                value={mergeToProblemId}
                onChange={(event) => setMergeToProblemId(event.target.value)}
                placeholder="例如：12"
              />
            </label>
            <button type="submit">驳回问题</button>
          </form>
        </>
      )}
    </section>
  )
}
