import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { requestJson } from '../lib/http'
import type { Problem, UserProfile } from '../types'

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
  const [pendingProblems, setPendingProblems] = useState<Problem[]>([])
  const [acceptors, setAcceptors] = useState<UserProfile[]>([])
  const [selectedProblemId, setSelectedProblemId] = useState<number | null>(null)
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(buildDefaultTaskDraft())
  const [rejectReason, setRejectReason] = useState('')
  const [mergeToProblemId, setMergeToProblemId] = useState('')
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

  const pickProblem = (problem: Problem) => {
    setSelectedProblemId(problem.id)
    setRejectReason('')
    setMergeToProblemId('')
    setTaskDraft((prev) => ({
      ...prev,
      title: prev.title || `${problem.title} - 任务`,
    }))
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

    try {
      setError(null)
      await requestJson(`/problems/${selectedProblem.id}/review`, {
        method: 'POST',
        userId,
        body: {
          approve: true,
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
      setTaskDraft(buildDefaultTaskDraft())
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '立项失败')
    }
  }

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>问题审核与任务定义</h2>
        <p>审核待立项问题，完成任务定义并指定验收人。</p>
      </header>
      {message && <p className="ok-text">{message}</p>}
      {error && <p className="error-text">{error}</p>}

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
              <span>#{item.submitter_id}</span>
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
                      <option value="quantified">quantified</option>
                      <option value="behavioral">behavioral</option>
                    </select>
                  </label>
                  <button type="button" onClick={() => removeCriteria(idx)}>
                    删除标准
                  </button>
                </div>
              ))}
            </div>
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
