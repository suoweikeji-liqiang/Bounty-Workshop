import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { AttachmentField } from '../components/AttachmentField'
import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type {
  Attachment,
  ClaimApprovalThresholdConfig,
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

type CriteriaDraft = {
  key: string
  label: string
  value: string
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

function hasAnyRole(profile: UserProfile | null, allowedRoles: string[]) {
  if (!profile) {
    return false
  }
  return profile.roles.some((role) => allowedRoles.includes(role))
}

function buildCriteriaDrafts(detail: ClaimExecutionDetail): CriteriaDraft[] {
  const byResult = detail.criteria_results ?? []
  const criteria = detail.acceptance_criteria ?? []
  if (criteria.length === 0) {
    return [
      {
        key: 'criteria-1',
        label: '验收项 #1',
        value: byResult[0] ?? '',
      },
    ]
  }
  return criteria.map((item, idx) => ({
    key: `criteria-${idx + 1}`,
    label: item.description?.trim() || `验收项 #${idx + 1}`,
    value: byResult[idx] ?? '',
  }))
}

export function TaskHallPage({ userId, profile }: Props) {
  const toast = useToast()
  const [openTasks, setOpenTasks] = useState<Task[]>([])
  const [inProgressTasks, setInProgressTasks] = useState<Task[]>([])
  const [activeUsers, setActiveUsers] = useState<UserProfile[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [claimMode, setClaimMode] = useState<ClaimMode>('individual')
  const [leadUserId, setLeadUserId] = useState(String(userId))
  const [members, setMembers] = useState<TeamMemberDraft[]>(buildDefaultMembers(userId))
  const [claimId, setClaimId] = useState('')
  const [summary, setSummary] = useState('')
  const [uploadedAttachments, setUploadedAttachments] = useState<Attachment[]>([])
  const [criteriaDrafts, setCriteriaDrafts] = useState<CriteriaDraft[]>([
    { key: 'criteria-1', label: '验收项 #1', value: '' },
  ])
  const [loadingClaimCriteria, setLoadingClaimCriteria] = useState(false)
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [filters, setFilters] = useState<TaskFilters>({
    level: '',
    scenario: '',
    rewardMin: '',
    rewardMax: '',
  })
  const [policyThreshold, setPolicyThreshold] = useState<number | null>(null)
  const [policyDraft, setPolicyDraft] = useState('')
  const [savingPolicy, setSavingPolicy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canApproveForOthers = useMemo(() => hasAnyRole(profile, ['admin', 'reviewer']), [profile])
  const canEditPolicy = useMemo(() => hasAnyRole(profile, ['admin']), [profile])

  const handleUploadedAttachmentsChange = (next: Attachment[]) => {
    setUploadedAttachments(next)
  }

  const visibleLeadUsers = useMemo(() => {
    if (canApproveForOthers) {
      return activeUsers
    }
    return activeUsers.filter((item) => item.id === userId)
  }, [activeUsers, canApproveForOthers, userId])

  const claimableTasks = useMemo(() => {
    const map = new Map<number, Task>()
    for (const row of [...openTasks, ...inProgressTasks]) {
      map.set(row.id, row)
    }
    return Array.from(map.values()).sort((a, b) => b.id - a.id)
  }, [openTasks, inProgressTasks])

  const load = useCallback(async () => {
    const buildTaskQuery = (status: 'open' | 'in_progress') => {
      const query = new URLSearchParams()
      query.set('status', status)
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
      const [open, progress, users] = await Promise.all([
        requestJson<Task[]>(buildTaskQuery('open'), { userId }),
        requestJson<Task[]>(buildTaskQuery('in_progress'), { userId }),
        requestJson<UserProfile[]>('/users/active', { userId }),
      ])
      setOpenTasks(open)
      setInProgressTasks(progress)
      setActiveUsers(users)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载任务大厅数据失败')
    }
  }, [filters.level, filters.rewardMax, filters.rewardMin, filters.scenario, userId])

  const loadPolicyThreshold = useCallback(async () => {
    if (!canApproveForOthers) {
      setPolicyThreshold(null)
      setPolicyDraft('')
      return
    }
    try {
      const payload = await requestJson<ClaimApprovalThresholdConfig>(
        '/system/config/claim-approval-overdue-threshold',
        { userId },
      )
      setPolicyThreshold(payload.threshold)
      setPolicyDraft(String(payload.threshold))
    } catch (err) {
      setPolicyThreshold(null)
      setPolicyDraft('')
      setError(err instanceof Error ? err.message : '加载揭榜审批策略失败')
    }
  }, [canApproveForOthers, userId])

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
      void loadPolicyThreshold()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load, loadPolicyThreshold])

  useEffect(() => {
    setLeadUserId(String(userId))
    setMembers(buildDefaultMembers(userId))
  }, [userId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadClaimCriteria(claimId)
    }, 200)
    return () => window.clearTimeout(timer)
  }, [claimId, loadClaimCriteria])

  useEffect(() => {
    if (!detailOpen) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetailOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [detailOpen])

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
        saveClaimRecord(taskId, res.claim_id)
        setClaimId(String(res.claim_id))
        setMessage(`任务 #${taskId} 揭榜已提交，claim_id=${res.claim_id}`)
        await load()
        return
      }

      const leadId = Number(leadUserId)
      if (!Number.isInteger(leadId) || leadId <= 0) {
        setError('请选择团队负责人')
        return
      }

      const parsedMembers = members
        .map((item) => ({ user_id: Number(item.user_id), ratio: Number(item.ratio) }))
        .filter(
          (item) =>
            Number.isInteger(item.user_id) && item.user_id > 0 && Number.isFinite(item.ratio) && item.ratio > 0,
        )

      if (parsedMembers.length < 2) {
        setError('团队揭榜至少需要 2 名成员')
        return
      }
      if (!parsedMembers.some((item) => item.user_id === leadId)) {
        setError('团队成员必须包含负责人')
        return
      }

      const ratioTotal = parsedMembers.reduce((acc, item) => acc + item.ratio, 0)
      if (Math.abs(ratioTotal - 1) > 0.0001) {
        setError('成员比例之和必须为 1')
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
      setClaimId(String(res.claim_id))
      setMessage(`任务 #${taskId} 团队揭榜已提交，claim_id=${res.claim_id}`)
      setMembers(buildDefaultMembers(userId))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '揭榜失败')
    }
  }

  const savePolicy = async () => {
    if (!canEditPolicy) {
      return
    }
    const threshold = Number(policyDraft)
    if (!Number.isInteger(threshold) || threshold < 1) {
      setError('阈值必须是大于等于 1 的整数')
      return
    }

    try {
      setSavingPolicy(true)
      setError(null)
      const payload = await requestJson<ClaimApprovalThresholdConfig>(
        '/system/config/claim-approval-overdue-threshold',
        {
          method: 'PUT',
          userId,
          body: { threshold },
        },
      )
      setPolicyThreshold(payload.threshold)
      setPolicyDraft(String(payload.threshold))
      setMessage(`揭榜审批阈值已更新为 ${payload.threshold}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '审批策略更新失败')
    } finally {
      setSavingPolicy(false)
    }
  }

  const submitDeliverable = async (event: FormEvent) => {
    event.preventDefault()
    const parsedClaimId = Number(claimId)
    if (!Number.isInteger(parsedClaimId) || parsedClaimId <= 0) {
      setError('请输入有效的 claim_id')
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
      setMessage('成果提交成功')
      setClaimId('')
      setSummary('')
      setUploadedAttachments([])
      setCriteriaDrafts([{ key: 'criteria-1', label: '验收项 #1', value: '' }])
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
        <p>查看可揭榜与进行中任务，支持团队协作与成果提交。</p>
      </header>

      {canApproveForOthers && (
        <article className="panel form-grid">
          <h3>揭榜审批策略</h3>
          <p className="wide muted">
            当超期数量达到阈值时，普通用户将被限制自助揭榜，管理员/评审可代为揭榜。
          </p>
          <label>
            当前阈值
            <input value={policyThreshold ?? '-'} disabled />
          </label>
          <label>
            新阈值
            <input
              type="number"
              min={1}
              value={policyDraft}
              onChange={(event) => setPolicyDraft(event.target.value)}
              disabled={!canEditPolicy}
            />
          </label>
          {canEditPolicy && (
            <div className="button-row wide">
              <button type="button" className="primary-btn" onClick={() => void savePolicy()} disabled={savingPolicy}>
                {savingPolicy ? '保存中...' : '保存策略'}
              </button>
            </div>
          )}
        </article>
      )}

      <form
        className="panel form-grid"
        onSubmit={(event) => {
          event.preventDefault()
          void load()
        }}
      >
        <h3>任务筛选</h3>
        <label>
          等级
          <select value={filters.level} onChange={(event) => setFilters((prev) => ({ ...prev, level: event.target.value }))}>
            <option value="">全部</option>
            <option value="S">S</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </label>
        <label>
          场景
          <select value={filters.scenario} onChange={(event) => setFilters((prev) => ({ ...prev, scenario: event.target.value }))}>
            <option value="">全部</option>
            <option value="rd">研发</option>
            <option value="ops">运维</option>
            <option value="delivery">交付</option>
            <option value="support">支持</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label>
          最低奖励
          <input type="number" value={filters.rewardMin} onChange={(event) => setFilters((prev) => ({ ...prev, rewardMin: event.target.value }))} />
        </label>
        <label>
          最高奖励
          <input type="number" value={filters.rewardMax} onChange={(event) => setFilters((prev) => ({ ...prev, rewardMax: event.target.value }))} />
        </label>
        <div className="button-row wide">
          <button className="primary-btn" type="submit">应用筛选</button>
          <button type="button" onClick={() => setFilters({ level: '', scenario: '', rewardMin: '', rewardMax: '' })}>重置</button>
        </div>
      </form>

      <article className="panel">
        <div className="panel-headline">
          <h3>可揭榜任务</h3>
          <button type="button" onClick={() => void load()}>刷新</button>
        </div>
        <div className="table">
          <div className="row head wide-row">
            <span>ID</span><span>标题</span><span>场景</span><span>等级</span><span>奖励</span><span>截止日期</span><span>揭榜数</span><span>操作</span>
          </div>
          {openTasks.map((task) => (
            <div className="row wide-row" key={task.id}>
              <span>#{task.id}</span>
              <span>{task.title}</span>
              <span>{task.scenario}</span>
              <span>{task.level}</span>
              <span>¥{task.reward_total.toFixed(0)}</span>
              <span>{task.due_date}</span>
              <span>{task.active_claim_count}</span>
              <span className="actions">
                <button type="button" onClick={() => void openTaskDetail(task.id)}>详情</button>
                <button type="button" onClick={() => setSelectedTaskId(String(task.id))}>选择</button>
                <button type="button" onClick={() => { setClaimMode('individual'); setSelectedTaskId(String(task.id)) }}>快速揭榜</button>
              </span>
            </div>
          ))}
        </div>
      </article>

      <form className="panel form-grid" onSubmit={submitClaim}>
        <h3>揭榜设置</h3>
        <label>
          任务 ID
          <select value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.target.value)} required>
            <option value="">请选择任务</option>
            {claimableTasks.map((task) => (
              <option key={`claim-task-${task.id}`} value={task.id}>
                #{task.id} [{task.status}] {task.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          模式
          <select value={claimMode} onChange={(event) => setClaimMode(event.target.value as ClaimMode)}>
            <option value="individual">个人</option>
            <option value="team">团队</option>
          </select>
        </label>

        {(claimMode === 'team' || canApproveForOthers) && (
          <label>
            负责人
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
              <h3>团队成员比例（总和 = 1）</h3>
              <button type="button" onClick={addMemberRow}>新增成员</button>
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
                <button type="button" onClick={() => removeMemberRow(idx)} disabled={members.length <= 2}>移除</button>
              </div>
            ))}
          </div>
        )}

        <button className="primary-btn" type="submit">提交揭榜</button>
      </form>

      <article className="panel">
        <h3>进行中任务（含本地 claim_id 映射）</h3>
        <div className="table">
          <div className="row head">
            <span>ID</span><span>标题</span><span>场景</span><span>状态</span><span>揭榜数</span><span>揭榜 ID</span>
          </div>
          {inProgressTasks.map((task) => (
            <div className="row" key={task.id}>
              <span>#{task.id}</span>
              <span>{task.title}</span>
              <span>{task.scenario}</span>
              <span>{task.status}</span>
              <span>{task.active_claim_count}</span>
              <span>{getClaimByTask(task.id) ?? '-'}</span>
            </div>
          ))}
        </div>
      </article>

      <form className="panel form-grid" onSubmit={submitDeliverable}>
        <h3>提交成果</h3>
        <label>
          揭榜 ID（claim_id）
          <input value={claimId} onChange={(event) => setClaimId(event.target.value)} required />
        </label>
        <label className="wide">
          成果说明
          <textarea value={summary} onChange={(event) => setSummary(event.target.value)} required />
        </label>
        <AttachmentField
          userId={userId}
          value={uploadedAttachments}
          onChange={handleUploadedAttachmentsChange}
          label="证据附件上传"
        />
        <div className="wide">
          <div className="panel-headline">
            <h3>验收项结果</h3>
            <button type="button" onClick={() => void loadClaimCriteria(claimId)} disabled={loadingClaimCriteria}>
              {loadingClaimCriteria ? '加载中...' : '重新加载验收项'}
            </button>
          </div>
          {criteriaDrafts.map((item, idx) => (
            <label className="wide" key={item.key}>
              {item.label}
              <textarea
                value={item.value}
                onChange={(event) =>
                  setCriteriaDrafts((prev) => prev.map((row, rowIdx) => rowIdx === idx ? { ...row, value: event.target.value } : row))
                }
                placeholder="填写该验收项的结果说明"
              />
            </label>
          ))}
        </div>
        <button className="primary-btn" type="submit">提交成果</button>
      </form>

      {detailOpen && taskDetail && (
        <div className="modal-backdrop" onClick={() => setDetailOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="panel-headline">
              <h3>任务 #{taskDetail.id} 详情</h3>
              <button type="button" onClick={() => setDetailOpen(false)}>关闭</button>
            </div>
            <p className="line-metric"><span>标题</span><strong>{taskDetail.title}</strong></p>
            <p className="line-metric"><span>目标</span><strong>{taskDetail.goal}</strong></p>
            <p className="line-metric"><span>范围</span><strong>{taskDetail.scope}</strong></p>
            <p className="line-metric"><span>等级/状态</span><strong>{taskDetail.level} / {taskDetail.status}</strong></p>
            <p className="line-metric"><span>截止日期</span><strong>{taskDetail.due_date}</strong></p>
            <article className="modal-section">
              <h4>验收标准</h4>
              <ul>
                {taskDetail.acceptance_criteria.map((item, idx) => (
                  <li key={`${item.description ?? 'criteria'}-${idx}`}>
                    {item.description ?? '未命名验收项'} ({item.type ?? '未知'})
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
