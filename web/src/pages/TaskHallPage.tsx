import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { requestJson } from '../lib/http'
import type { Task, TaskDetail, UserProfile } from '../types'

type Props = {
  userId: number
}

type ClaimMode = 'individual' | 'team'

type TeamMemberDraft = {
  user_id: string
  ratio: string
}

const claimStorageKey = 'bw_claim_records'

function saveClaimRecord(taskId: number, claimId: number) {
  const raw = localStorage.getItem(claimStorageKey)
  const map = raw ? (JSON.parse(raw) as Record<string, number>) : {}
  map[String(taskId)] = claimId
  localStorage.setItem(claimStorageKey, JSON.stringify(map))
}

function getClaimByTask(taskId: number): number | null {
  const raw = localStorage.getItem(claimStorageKey)
  if (!raw) {
    return null
  }
  const map = JSON.parse(raw) as Record<string, number>
  return map[String(taskId)] ?? null
}

function buildDefaultMembers(userId: number): TeamMemberDraft[] {
  return [
    { user_id: String(userId), ratio: '0.6' },
    { user_id: '', ratio: '0.4' },
  ]
}

export function TaskHallPage({ userId }: Props) {
  const [openTasks, setOpenTasks] = useState<Task[]>([])
  const [inProgressTasks, setInProgressTasks] = useState<Task[]>([])
  const [activeUsers, setActiveUsers] = useState<UserProfile[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [claimMode, setClaimMode] = useState<ClaimMode>('individual')
  const [leadUserId, setLeadUserId] = useState(String(userId))
  const [members, setMembers] = useState<TeamMemberDraft[]>(buildDefaultMembers(userId))
  const [claimId, setClaimId] = useState('')
  const [summary, setSummary] = useState('')
  const [attachments, setAttachments] = useState('')
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const [open, progress, users] = await Promise.all([
        requestJson<Task[]>('/tasks?status=open', { userId }),
        requestJson<Task[]>('/tasks?status=in_progress', { userId }),
        requestJson<UserProfile[]>('/users/active', { userId }),
      ])
      setOpenTasks(open)
      setInProgressTasks(progress)
      setActiveUsers(users)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    }
  }, [userId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const addMemberRow = () => {
    setMembers((prev) => [...prev, { user_id: '', ratio: '' }])
  }

  const removeMemberRow = (idx: number) => {
    setMembers((prev) => prev.filter((_, index) => index !== idx))
  }

  const submitClaim = async (event: FormEvent) => {
    event.preventDefault()
    const taskId = Number(selectedTaskId)
    if (!Number.isInteger(taskId) || taskId <= 0) {
      setError('请选择待揭榜任务')
      return
    }

    try {
      setError(null)
      if (claimMode === 'individual') {
        const res = await requestJson<{ claim_id: number }>(`/tasks/${taskId}/claims`, {
          method: 'POST',
          userId,
          body: { mode: 'individual' },
        })
        saveClaimRecord(taskId, res.claim_id)
        setMessage(`任务 #${taskId} 揭榜成功，claim_id=${res.claim_id}`)
        await load()
        return
      }

      const leadId = Number(leadUserId)
      if (!Number.isInteger(leadId) || leadId <= 0) {
        setError('请选择联合揭榜负责人')
        return
      }

      const parsedMembers = members
        .map((item) => ({
          user_id: Number(item.user_id),
          ratio: Number(item.ratio),
        }))
        .filter(
          (item) =>
            Number.isInteger(item.user_id) &&
            item.user_id > 0 &&
            Number.isFinite(item.ratio) &&
            item.ratio > 0,
        )

      if (parsedMembers.length < 2) {
        setError('联合揭榜至少需要两名成员')
        return
      }
      if (!parsedMembers.some((item) => item.user_id === leadId)) {
        setError('成员列表必须包含负责人')
        return
      }

      const ratioTotal = parsedMembers.reduce((acc, item) => acc + item.ratio, 0)
      if (Math.abs(ratioTotal - 1) > 0.0001) {
        setError('成员比例总和必须等于 1')
        return
      }

      const res = await requestJson<{ claim_id: number }>(`/tasks/${taskId}/claims`, {
        method: 'POST',
        userId,
        body: {
          mode: 'team',
          lead_user_id: leadId,
          members: parsedMembers,
        },
      })
      saveClaimRecord(taskId, res.claim_id)
      setMessage(`任务 #${taskId} 联合揭榜成功，claim_id=${res.claim_id}`)
      setMembers(buildDefaultMembers(userId))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '揭榜失败')
    }
  }

  const submitDeliverable = async (event: FormEvent) => {
    event.preventDefault()
    try {
      setError(null)
      const attachmentIds = attachments
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item > 0)
      await requestJson(`/claims/${claimId}/deliverables`, {
        method: 'POST',
        userId,
        body: {
          summary,
          criteria_results: ['前端提交'],
          evidence_attachment_ids: attachmentIds,
          evidence_urls: [],
        },
      })
      setMessage('成果提交成功')
      setClaimId('')
      setSummary('')
      setAttachments('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '成果提交失败')
    }
  }

  const openTaskDetail = async (taskId: number) => {
    try {
      setError(null)
      const payload = await requestJson<TaskDetail>(`/tasks/${taskId}`, { userId })
      setTaskDetail(payload)
      setDetailOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载任务详情失败')
    }
  }

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>任务大厅</h2>
        <p>公开揭榜、联合协作与执行反馈。</p>
      </header>
      {message && <p className="ok-text">{message}</p>}
      {error && <p className="error-text">{error}</p>}
      <article className="panel">
        <div className="panel-headline">
          <h3>待揭榜任务</h3>
          <button type="button" onClick={() => void load()}>
            刷新
          </button>
        </div>
        <div className="table">
          <div className="row head wide-row">
            <span>ID</span>
            <span>标题</span>
            <span>等级</span>
            <span>激励</span>
            <span>截止</span>
            <span>动作</span>
          </div>
          {openTasks.map((task) => (
            <div className="row wide-row" key={task.id}>
              <span>#{task.id}</span>
              <span>{task.title}</span>
              <span>{task.level}</span>
              <span>¥{task.reward_total.toFixed(0)}</span>
              <span>{task.due_date}</span>
              <span className="actions">
                <button type="button" onClick={() => void openTaskDetail(task.id)}>
                  详情
                </button>
                <button type="button" onClick={() => setSelectedTaskId(String(task.id))}>
                  选择
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setClaimMode('individual')
                    setSelectedTaskId(String(task.id))
                  }}
                >
                  个人揭榜
                </button>
              </span>
            </div>
          ))}
        </div>
      </article>

      <form className="panel form-grid" onSubmit={submitClaim}>
        <h3>揭榜配置</h3>
        <label>
          task_id
          <select value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.target.value)} required>
            <option value="">请选择任务</option>
            {openTasks.map((task) => (
              <option key={`claim-task-${task.id}`} value={task.id}>
                #{task.id} {task.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          mode
          <select
            value={claimMode}
            onChange={(event) => setClaimMode(event.target.value as ClaimMode)}
          >
            <option value="individual">individual</option>
            <option value="team">team</option>
          </select>
        </label>

        {claimMode === 'team' && (
          <>
            <label>
              负责人
              <select value={leadUserId} onChange={(event) => setLeadUserId(event.target.value)} required>
                {activeUsers.map((user) => (
                  <option key={`lead-${user.id}`} value={user.id}>
                    #{user.id} {user.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="wide">
              <div className="panel-headline">
                <h3>成员比例（总和=1）</h3>
                <button type="button" onClick={addMemberRow}>
                  添加成员
                </button>
              </div>
              {members.map((item, idx) => (
                <div className="acceptance-editor" key={`member-${idx}`}>
                  <label>
                    成员
                    <select
                      value={item.user_id}
                      onChange={(event) =>
                        setMembers((prev) =>
                          prev.map((row, rowIdx) =>
                            rowIdx === idx ? { ...row, user_id: event.target.value } : row,
                          ),
                        )
                      }
                    >
                      <option value="">请选择</option>
                      {activeUsers.map((user) => (
                        <option key={`member-${idx}-${user.id}`} value={user.id}>
                          #{user.id} {user.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    ratio
                    <input
                      type="number"
                      min="0.01"
                      max="1"
                      step="0.01"
                      value={item.ratio}
                      onChange={(event) =>
                        setMembers((prev) =>
                          prev.map((row, rowIdx) =>
                            rowIdx === idx ? { ...row, ratio: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <button type="button" onClick={() => removeMemberRow(idx)} disabled={members.length <= 2}>
                    删除
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        <button className="primary-btn" type="submit">
          提交揭榜
        </button>
      </form>

      <article className="panel">
        <h3>进行中任务（含本地记录 claim_id）</h3>
        <div className="table">
          <div className="row head">
            <span>ID</span>
            <span>标题</span>
            <span>状态</span>
            <span>claim_id</span>
          </div>
          {inProgressTasks.map((task) => (
            <div className="row" key={task.id}>
              <span>#{task.id}</span>
              <span>{task.title}</span>
              <span>{task.status}</span>
              <span>{getClaimByTask(task.id) ?? '-'}</span>
            </div>
          ))}
        </div>
      </article>
      <form className="panel form-grid" onSubmit={submitDeliverable}>
        <h3>提交成果</h3>
        <label>
          claim_id
          <input value={claimId} onChange={(event) => setClaimId(event.target.value)} required />
        </label>
        <label className="wide">
          成果说明
          <textarea value={summary} onChange={(event) => setSummary(event.target.value)} required />
        </label>
        <label className="wide">
          证据附件 ID（逗号分隔）
          <input
            value={attachments}
            onChange={(event) => setAttachments(event.target.value)}
            placeholder="例如: 8,9"
          />
        </label>
        <button className="primary-btn" type="submit">
          提交成果
        </button>
      </form>
      {detailOpen && taskDetail && (
        <div className="modal-backdrop" onClick={() => setDetailOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="panel-headline">
              <h3>任务 #{taskDetail.id} 详情</h3>
              <button type="button" onClick={() => setDetailOpen(false)}>
                关闭
              </button>
            </div>
            <p className="line-metric">
              <span>标题</span>
              <strong>{taskDetail.title}</strong>
            </p>
            <p className="line-metric">
              <span>目标</span>
              <strong>{taskDetail.goal}</strong>
            </p>
            <p className="line-metric">
              <span>范围</span>
              <strong>{taskDetail.scope}</strong>
            </p>
            <p className="line-metric">
              <span>等级/状态</span>
              <strong>
                {taskDetail.level} / {taskDetail.status}
              </strong>
            </p>
            <p className="line-metric">
              <span>截止</span>
              <strong>{taskDetail.due_date}</strong>
            </p>
            <article className="modal-section">
              <h4>验收标准</h4>
              <ul>
                {taskDetail.acceptance_criteria.map((item, idx) => (
                  <li key={`${item.description ?? 'criteria'}-${idx}`}>
                    {item.description ?? '未命名标准'} ({item.type ?? 'unknown'})
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </div>
      )}
    </section>
  )
}
