import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { AttachmentField } from '../components/AttachmentField'
import { TaskActivityTimeline } from '../components/TaskActivityTimeline'
import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type {
  Attachment,
  ClaimExecution,
  ClaimExecutionDetail,
  Task,
  TaskDetail,
  UserProfile,
} from '../types'

type Props = {
  userId: number
  profile: UserProfile | null
}

type ClaimMode = 'individual' | 'team'

type TeamMemberDraft = {
  user_id: string
  ratio: string
}

type TaskFilters = {
  level: string
  scenario: string
  rewardMin: string
  rewardMax: string
}

const defaultTaskFilters: TaskFilters = {
  level: '',
  scenario: '',
  rewardMin: '',
  rewardMax: '',
}

type CriteriaDraft = {
  key: string
  label: string
  value: string
}

function buildDefaultMembers(userId: number): TeamMemberDraft[] {
  return [
    { user_id: String(userId), ratio: '0.6' },
    { user_id: '', ratio: '0.4' },
  ]
}

function hasAnyRole(profile: UserProfile | null, allowedRoles: string[]) {
  if (!profile) {
    return false
  }
  return profile.roles.some((role) => allowedRoles.includes(role))
}

function formatTaskStatus(status: string | null | undefined) {
  if (!status) return '-'
  const map: Record<string, string> = {
    open: '待揭榜',
    in_progress: '执行中',
    completed: '已完成',
    archived: '已归档',
    active: '进行中',
    abandoned: '已放弃',
    submitted: '已提交',
    approved: '通过',
    rework: '待整改',
    rejected: '不通过',
  }
  return map[status] ?? status
}

function formatScenario(scenario: string | null | undefined) {
  if (!scenario) return '-'
  const map: Record<string, string> = {
    rd: '研发',
    ops: '运维',
    delivery: '交付',
    support: '支持',
    other: '其他',
  }
  return map[scenario] ?? scenario
}

function buildCriteriaDrafts(detail: ClaimExecutionDetail): CriteriaDraft[] {
  const byResult = detail.criteria_results ?? []
  const criteria = detail.acceptance_criteria ?? []
  if (criteria.length === 0) {
    return [{ key: 'criteria-1', label: '验收项 #1', value: byResult[0] ?? '' }]
  }
  return criteria.map((item, idx) => ({
    key: `criteria-${idx + 1}`,
    label: item.description?.trim() || `验收项 #${idx + 1}`,
    value: byResult[idx] ?? '',
  }))
}

export function TaskHallPage({ userId, profile }: Props) {
  const toast = useToast()
  const [allTasks, setAllTasks] = useState<Task[]>([])
  const [activeUsers, setActiveUsers] = useState<UserProfile[]>([])
  const [myClaims, setMyClaims] = useState<ClaimExecution[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [claimMode, setClaimMode] = useState<ClaimMode>('individual')
  const [leadUserId, setLeadUserId] = useState(String(userId))
  const [members, setMembers] = useState<TeamMemberDraft[]>(buildDefaultMembers(userId))
  const [deliverableClaimId, setDeliverableClaimId] = useState('')
  const [summary, setSummary] = useState('')
  const [uploadedAttachments, setUploadedAttachments] = useState<Attachment[]>([])
  const [criteriaDrafts, setCriteriaDrafts] = useState<CriteriaDraft[]>([
    { key: 'criteria-1', label: '验收项 #1', value: '' },
  ])
  const [loadingClaimCriteria, setLoadingClaimCriteria] = useState(false)
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [deliverableOpen, setDeliverableOpen] = useState(false)
  const [claimPanelOpen, setClaimPanelOpen] = useState(false)
  const [activeDeliverableClaim, setActiveDeliverableClaim] = useState<ClaimExecution | null>(null)
  const [filterDraft, setFilterDraft] = useState<TaskFilters>(defaultTaskFilters)
  const [filters, setFilters] = useState<TaskFilters>(defaultTaskFilters)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canApproveForOthers = useMemo(() => hasAnyRole(profile, ['admin', 'reviewer']), [profile])
  const detailDefaultClaimId = useMemo(() => {
    if (!taskDetail) return null
    const claim = myClaims.find((item) => item.task_id === taskDetail.id && item.claim_status === 'active')
    return claim?.claim_id ?? null
  }, [myClaims, taskDetail])

  const handleUploadedAttachmentsChange = (next: Attachment[]) => {
    setUploadedAttachments(next)
  }

  const visibleLeadUsers = useMemo(() => {
    if (canApproveForOthers) {
      return activeUsers
    }
    return activeUsers.filter((item) => item.id === userId)
  }, [activeUsers, canApproveForOthers, userId])

  const openTasks = useMemo(
    () => allTasks.filter((item) => item.status === 'open'),
    [allTasks],
  )
  const inProgressTasks = useMemo(
    () => allTasks.filter((item) => item.status === 'in_progress'),
    [allTasks],
  )
  const pendingAcceptanceTasks = useMemo(
    () => allTasks.filter((item) => item.status === 'pending_acceptance'),
    [allTasks],
  )
  const completedTasks = useMemo(
    () => allTasks.filter((item) => item.status === 'completed'),
    [allTasks],
  )

  const claimableTasks = useMemo(() => {
    const map = new Map<number, Task>()
    for (const row of [...openTasks, ...inProgressTasks]) {
      map.set(row.id, row)
    }
    return Array.from(map.values()).sort((a, b) => b.id - a.id)
  }, [inProgressTasks, openTasks])

  const deliverableClaimOptions = useMemo(
    () =>
      myClaims
        .filter((item) => item.claim_status === 'active')
        .sort((a, b) => b.claim_id - a.claim_id),
    [myClaims],
  )

  const hasPendingFilterChanges = useMemo(
    () =>
      filterDraft.level !== filters.level ||
      filterDraft.scenario !== filters.scenario ||
      filterDraft.rewardMin !== filters.rewardMin ||
      filterDraft.rewardMax !== filters.rewardMax,
    [filterDraft, filters],
  )

  const load = useCallback(async () => {
    const buildTaskQuery = () => {
      const query = new URLSearchParams()
      if (filters.level) {
        query.set('level', filters.level)
      }
      if (filters.scenario) {
        query.set('scenario', filters.scenario)
      }
      if (filters.rewardMin.trim()) {
        query.set('reward_min', filters.rewardMin.trim())
      }
      if (filters.rewardMax.trim()) {
        query.set('reward_max', filters.rewardMax.trim())
      }
      return `/tasks?${query.toString()}`
    }

    try {
      setError(null)
      const [tasks, users, claims] = await Promise.all([
        requestJson<Task[]>(buildTaskQuery(), { userId }),
        requestJson<UserProfile[]>('/users/active', { userId }),
        requestJson<ClaimExecution[]>('/claims/mine', { userId }),
      ])
      setAllTasks(tasks)
      setActiveUsers(users)
      setMyClaims(claims)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载任务大厅数据失败')
    }
  }, [filters.level, filters.rewardMax, filters.rewardMin, filters.scenario, userId])

  const loadClaimCriteria = useCallback(
    async (targetClaimId: string) => {
      const parsed = Number(targetClaimId)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setCriteriaDrafts([{ key: 'criteria-1', label: '验收项 #1', value: '' }])
        return
      }
      try {
        setLoadingClaimCriteria(true)
        const detail = await requestJson<ClaimExecutionDetail>(`/claims/${parsed}/detail`, { userId })
        setCriteriaDrafts(buildCriteriaDrafts(detail))
      } catch {
        setCriteriaDrafts([{ key: 'criteria-1', label: '验收项 #1', value: '' }])
      } finally {
        setLoadingClaimCriteria(false)
      }
    },
    [userId],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    setLeadUserId(String(userId))
    setMembers(buildDefaultMembers(userId))
  }, [userId])

  useEffect(() => {
    if (!deliverableOpen) {
      return
    }
    const timer = window.setTimeout(() => {
      void loadClaimCriteria(deliverableClaimId)
    }, 200)
    return () => window.clearTimeout(timer)
  }, [deliverableClaimId, deliverableOpen, loadClaimCriteria])

  useEffect(() => {
    if (!detailOpen && !deliverableOpen) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetailOpen(false)
        setDeliverableOpen(false)
        setActiveDeliverableClaim(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [deliverableOpen, detailOpen])

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
      setError('请选择要揭榜的任务')
      return
    }

    try {
      setError(null)

      if (claimMode === 'individual') {
        const leadId = Number(leadUserId)
        const body: { mode: 'individual'; lead_user_id?: number } = { mode: 'individual' }
        if (Number.isInteger(leadId) && leadId > 0 && (canApproveForOthers || leadId === userId)) {
          body.lead_user_id = leadId
        }

        const res = await requestJson<{ claim_id: number }>(`/tasks/${taskId}/claims`, {
          method: 'POST',
          userId,
          body,
        })
        setMessage(`揭榜已提交：任务 #${taskId}，揭榜 #${res.claim_id}`)
        setClaimPanelOpen(false)
        await load()
        return
      }

      const leadId = Number(leadUserId)
      if (!Number.isInteger(leadId) || leadId <= 0) {
        setError('请选择组长')
        return
      }

      const parsedMembers = members
        .map((item) => ({ user_id: Number(item.user_id), ratio: Number(item.ratio) }))
        .filter(
          (item) =>
            Number.isInteger(item.user_id) && item.user_id > 0 && Number.isFinite(item.ratio) && item.ratio > 0,
        )

      if (parsedMembers.length < 2) {
        setError('组队揭榜至少需要 2 名成员')
        return
      }
      if (!parsedMembers.some((item) => item.user_id === leadId)) {
        setError('组队成员中必须包含组长')
        return
      }

      const ratioTotal = parsedMembers.reduce((acc, item) => acc + item.ratio, 0)
      if (Math.abs(ratioTotal - 1) > 0.0001) {
        setError('成员分成比例之和必须为 1')
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
      setMessage(`组队揭榜已提交：任务 #${taskId}，揭榜 #${res.claim_id}`)
      setMembers(buildDefaultMembers(userId))
      setClaimPanelOpen(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '揭榜失败')
    }
  }

  const openDeliverableEditor = (claim: ClaimExecution) => {
    setActiveDeliverableClaim(claim)
    setDeliverableClaimId(String(claim.claim_id))
    setSummary('')
    setUploadedAttachments([])
    setCriteriaDrafts([{ key: 'criteria-1', label: '验收项 #1', value: '' }])
    setDeliverableOpen(true)
  }

  const closeDeliverableEditor = () => {
    if (loadingClaimCriteria) {
      return
    }
    setDeliverableOpen(false)
    setActiveDeliverableClaim(null)
    setDeliverableClaimId('')
    setSummary('')
    setUploadedAttachments([])
    setCriteriaDrafts([{ key: 'criteria-1', label: '验收项 #1', value: '' }])
  }

  const submitDeliverable = async (event: FormEvent) => {
    event.preventDefault()
    const parsedClaimId = Number(deliverableClaimId)
    if (!Number.isInteger(parsedClaimId) || parsedClaimId <= 0) {
      setError('请选择有效的揭榜记录')
      return
    }

    try {
      setError(null)
      const attachmentIds = uploadedAttachments.map((item) => item.id)

      const criteriaResults = criteriaDrafts
        .map((item) => item.value.trim())
        .filter((item) => item.length > 0)

      await requestJson(`/claims/${parsedClaimId}/deliverables`, {
        method: 'POST',
        userId,
        body: {
          summary,
          criteria_results: criteriaResults,
          evidence_attachment_ids: attachmentIds,
          evidence_urls: [],
        },
      })
      setMessage('成果已提交')
      closeDeliverableEditor()
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
        <h2>任务大厅</h2>
        <p>浏览任务、提交揭榜并上传执行成果。</p>
      </header>

      <form
        className="panel filter-panel"
        onSubmit={(event) => {
          event.preventDefault()
          if (hasPendingFilterChanges) {
            setFilters(filterDraft)
            return
          }
          void load()
        }}
      >
        <div className="panel-headline">
          <h3>任务筛选</h3>
        </div>
        <div className="filter-toolbar">
          <label className="filter-field">
            <span>等级</span>
          <select value={filterDraft.level} onChange={(event) => setFilterDraft((prev) => ({ ...prev, level: event.target.value }))}>
            <option value="">全部</option>
            <option value="S">S</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
          </label>
          <label className="filter-field">
            <span>场景</span>
          <select value={filterDraft.scenario} onChange={(event) => setFilterDraft((prev) => ({ ...prev, scenario: event.target.value }))}>
            <option value="">全部</option>
            <option value="rd">研发</option>
            <option value="ops">运维</option>
            <option value="delivery">交付</option>
            <option value="support">支持</option>
            <option value="other">其他</option>
          </select>
          </label>
          <label className="filter-field">
            <span>最低奖励</span>
          <input type="number" value={filterDraft.rewardMin} onChange={(event) => setFilterDraft((prev) => ({ ...prev, rewardMin: event.target.value }))} />
          </label>
          <label className="filter-field">
            <span>最高奖励</span>
          <input type="number" value={filterDraft.rewardMax} onChange={(event) => setFilterDraft((prev) => ({ ...prev, rewardMax: event.target.value }))} />
          </label>
          <div className="filter-actions">
            <button className="primary-btn" type="submit">应用筛选</button>
            <button
              type="button"
              onClick={() => {
                setFilterDraft(defaultTaskFilters)
                setFilters(defaultTaskFilters)
              }}
            >
              重置
            </button>
            <button type="button" onClick={() => void load()}>刷新</button>
          </div>
        </div>
      </form>

      <article className="panel">
        <div className="panel-headline">
          <h3>可揭榜任务</h3>
          <button type="button" onClick={() => void load()}>刷新</button>
        </div>
        <div className="table">
          <div className="row head task-open-row">
            <span>ID</span><span>标题</span><span>场景</span><span>等级</span><span>奖励</span><span>截止日</span><span>揭榜数</span><span>操作</span>
          </div>
          {openTasks.map((task) => (
            <div className="row task-open-row" key={task.id}>
              <span>#{task.id}</span>
              <span title={task.title}>{task.title}</span>
              <span>{formatScenario(task.scenario)}</span>
              <span>{task.level}</span>
              <span>¥{task.reward_total.toFixed(0)}</span>
              <span>{task.due_date}</span>
              <span>{task.active_claim_count}</span>
              <span className="actions">
                <button type="button" onClick={() => void openTaskDetail(task.id)}>详情</button>
                <button
                  type="button"
                  onClick={() => {
                    setClaimMode('individual')
                    setSelectedTaskId(String(task.id))
                    setClaimPanelOpen(true)
                  }}
                >
                  快速揭榜
                </button>
              </span>
            </div>
          ))}
          {openTasks.length === 0 && <p className="muted">暂无待揭榜任务</p>}
        </div>
      </article>

      <article className="panel">
        <div className="panel-headline">
          <h3>全部任务状态</h3>
          <p className="muted">
            待揭榜 {openTasks.length} / 执行中 {inProgressTasks.length} / 待验收 {pendingAcceptanceTasks.length} / 已完成 {completedTasks.length}
          </p>
        </div>
        <div className="table">
          <div className="row head task-all-row">
            <span>ID</span><span>标题</span><span>场景</span><span>等级</span><span>状态</span><span>奖励</span><span>截止日</span><span>揭榜数</span><span>操作</span>
          </div>
          {allTasks.map((task) => (
            <div className="row task-all-row" key={`all-task-${task.id}`}>
              <span>#{task.id}</span>
              <span title={task.title}>{task.title}</span>
              <span>{formatScenario(task.scenario)}</span>
              <span>{task.level}</span>
              <span>{formatTaskStatus(task.status)}</span>
              <span>¥{task.reward_total.toFixed(0)}</span>
              <span>{task.due_date}</span>
              <span>{task.active_claim_count}</span>
              <span className="actions">
                <button type="button" onClick={() => void openTaskDetail(task.id)}>详情</button>
                {task.status === 'open' && (
                  <button
                    type="button"
                    onClick={() => {
                      setClaimMode('individual')
                      setSelectedTaskId(String(task.id))
                      setClaimPanelOpen(true)
                    }}
                  >
                    揭榜
                  </button>
                )}
              </span>
            </div>
          ))}
          {allTasks.length === 0 && <p className="muted">暂无匹配任务</p>}
        </div>
      </article>

      <article className="panel">
        <div className="panel-headline">
          <h3>揭榜设置</h3>
          <button type="button" onClick={() => setClaimPanelOpen((prev) => !prev)}>
            {claimPanelOpen ? '收起' : '展开'}
          </button>
        </div>
        {claimPanelOpen ? (
          <form className="form-grid" onSubmit={submitClaim}>
            <label>
              任务
              <select value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.target.value)} required>
                <option value="">请选择任务</option>
                {claimableTasks.map((task) => (
                  <option key={`claim-task-${task.id}`} value={task.id}>
                    #{task.id} [{formatTaskStatus(task.status)}] {task.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              模式
              <select value={claimMode} onChange={(event) => setClaimMode(event.target.value as ClaimMode)}>
                <option value="individual">个人</option>
                <option value="team">组队</option>
              </select>
            </label>

            {(claimMode === 'team' || canApproveForOthers) && (
              <label>
                组长
                <select value={leadUserId} onChange={(event) => setLeadUserId(event.target.value)} required>
                  {visibleLeadUsers.map((user) => (
                    <option key={`lead-${user.id}`} value={user.id}>#{user.id} {user.name}</option>
                  ))}
                </select>
              </label>
            )}

            {claimMode === 'team' && (
              <div className="wide">
                <div className="panel-headline">
                  <h3>团队成员分成（总和 = 1）</h3>
                  <button type="button" onClick={addMemberRow}>添加成员</button>
                </div>
                {members.map((item, idx) => (
                  <div className="acceptance-editor" key={`member-${idx}`}>
                    <label>
                      成员
                      <select
                        value={item.user_id}
                        onChange={(event) => setMembers((prev) => prev.map((row, rowIdx) => rowIdx === idx ? { ...row, user_id: event.target.value } : row))}
                      >
                        <option value="">请选择成员</option>
                        {activeUsers.map((user) => (
                          <option key={`member-${idx}-${user.id}`} value={user.id}>#{user.id} {user.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      比例
                      <input
                        type="number"
                        min="0.01"
                        max="1"
                        step="0.01"
                        value={item.ratio}
                        onChange={(event) => setMembers((prev) => prev.map((row, rowIdx) => rowIdx === idx ? { ...row, ratio: event.target.value } : row))}
                      />
                    </label>
                    <button type="button" onClick={() => removeMemberRow(idx)} disabled={members.length <= 2}>删除</button>
                  </div>
                ))}
              </div>
            )}

            <div className="button-row wide">
              <button type="button" onClick={() => setClaimPanelOpen(false)}>取消</button>
              <button className="primary-btn" type="submit">提交揭榜</button>
            </div>
          </form>
        ) : (
          <p className="muted">点击“展开”后可选择任务并提交揭榜。</p>
        )}
      </article>

      <article className="panel">
        <div className="panel-headline">
          <h3>我的执行任务</h3>
          <button type="button" onClick={() => void load()}>刷新</button>
        </div>
        <p className="muted">提交成果请从任务操作进入，不在页面外层单独暴露。</p>
        <div className="table">
          <div className="row head task-claim-row">
            <span>揭榜ID</span><span>任务</span><span>模式</span><span>揭榜状态</span><span>成果状态</span><span>截止日</span><span>操作</span>
          </div>
          {deliverableClaimOptions.map((item) => (
            <div className="row task-claim-row" key={item.claim_id}>
              <span>#{item.claim_id}</span>
              <span title={item.task_title}>{item.task_title}</span>
              <span>{item.claim_mode === 'team' ? '组队' : '个人'}</span>
              <span>{formatTaskStatus(item.claim_status)}</span>
              <span>{formatTaskStatus(item.deliverable_status)}</span>
              <span>{item.due_date}</span>
              <span className="actions">
                <button type="button" onClick={() => void openTaskDetail(item.task_id)}>任务详情</button>
                <button type="button" onClick={() => openDeliverableEditor(item)}>提交成果</button>
              </span>
            </div>
          ))}
          {deliverableClaimOptions.length === 0 && <p className="muted">暂无进行中的揭榜任务</p>}
        </div>
      </article>

      {deliverableOpen && activeDeliverableClaim && (
        <div className="modal-backdrop" onClick={closeDeliverableEditor}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="deliverable-editor-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-headline">
              <h3 id="deliverable-editor-title">提交成果（揭榜 #{activeDeliverableClaim.claim_id}）</h3>
              <button type="button" onClick={closeDeliverableEditor}>关闭</button>
            </div>
            <p className="muted">
              任务：{activeDeliverableClaim.task_title} / 截止日：{activeDeliverableClaim.due_date}
            </p>
            <form className="form-grid" onSubmit={submitDeliverable}>
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
              <div className="wide">
                <div className="panel-headline">
                  <h3>验收项结果</h3>
                  <button type="button" onClick={() => void loadClaimCriteria(deliverableClaimId)} disabled={loadingClaimCriteria}>
                    {loadingClaimCriteria ? '加载中...' : '重新加载验收项'}
                  </button>
                </div>
                {criteriaDrafts.map((item, idx) => (
                  <label className="wide" key={item.key}>
                    {item.label}
                    <textarea
                      value={item.value}
                      onChange={(event) =>
                        setCriteriaDrafts((prev) =>
                          prev.map((row, rowIdx) => (rowIdx === idx ? { ...row, value: event.target.value } : row)),
                        )
                      }
                      placeholder="填写该验收项的结果"
                    />
                  </label>
                ))}
              </div>
              <div className="button-row wide">
                <button type="button" onClick={closeDeliverableEditor}>取消</button>
                <button className="primary-btn" type="submit">提交成果</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detailOpen && taskDetail && (
        <div className="modal-backdrop" onClick={() => setDetailOpen(false)}>
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-detail-title"
          >
            <div className="panel-headline">
              <h3 id="task-detail-title">任务 #{taskDetail.id} 详情</h3>
              <button type="button" onClick={() => setDetailOpen(false)}>关闭</button>
            </div>
            <p className="line-metric"><span>标题</span><strong>{taskDetail.title}</strong></p>
            <p className="line-metric"><span>目标</span><strong>{taskDetail.goal}</strong></p>
            <p className="line-metric"><span>范围</span><strong>{taskDetail.scope}</strong></p>
            <p className="line-metric"><span>等级/状态</span><strong>{taskDetail.level} / {formatTaskStatus(taskDetail.status)}</strong></p>
            <p className="line-metric"><span>任务类型</span><strong>{taskDetail.is_complex ? '复杂任务' : '普通任务'}</strong></p>
            <p className="line-metric"><span>截止日</span><strong>{taskDetail.due_date}</strong></p>
            <article className="modal-section">
              <h4>验收标准</h4>
              <ul>
                {taskDetail.acceptance_criteria.map((item, idx) => (
                  <li key={`${item.description ?? 'criteria'}-${idx}`}>
                    {item.description ?? '未命名标准'}（{item.type ?? '未知类型'}）
                  </li>
                ))}
              </ul>
            </article>
            <TaskActivityTimeline
              userId={userId}
              taskId={taskDetail.id}
              title="协作时间线"
              defaultClaimId={detailDefaultClaimId}
            />
          </div>
        </div>
      )}
    </section>
  )
}
