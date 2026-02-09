import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { requestJson } from '../lib/http'
import type { ClaimApprovalThresholdConfig, ClaimExecutionDetail, Task, TaskDetail, UserProfile } from '../types'

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
        label: 'criteria #1',
        value: byResult[0] ?? '',
      },
    ]
  }
  return criteria.map((item, idx) => ({
    key: `criteria-${idx + 1}`,
    label: item.description?.trim() || `criteria #${idx + 1}`,
    value: byResult[idx] ?? '',
  }))
}

export function TaskHallPage({ userId, profile }: Props) {
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
  const [criteriaDrafts, setCriteriaDrafts] = useState<CriteriaDraft[]>([
    { key: 'criteria-1', label: 'criteria #1', value: '' },
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
      setError(err instanceof Error ? err.message : 'failed to load task hall data')
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
      setError(err instanceof Error ? err.message : 'failed to load claim approval policy')
    }
  }, [canApproveForOthers, userId])

  const loadClaimCriteria = useCallback(
    async (targetClaimId: string) => {
      const parsed = Number(targetClaimId)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setCriteriaDrafts([{ key: 'criteria-1', label: 'criteria #1', value: '' }])
        return
      }
      try {
        setLoadingClaimCriteria(true)
        const detail = await requestJson<ClaimExecutionDetail>(`/claims/${parsed}/detail`, { userId })
        setCriteriaDrafts(buildCriteriaDrafts(detail))
      } catch {
        setCriteriaDrafts([{ key: 'criteria-1', label: 'criteria #1', value: '' }])
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
      setError('please choose a task to claim')
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
        setMessage(`task #${taskId} claim submitted, claim_id=${res.claim_id}`)
        await load()
        return
      }

      const leadId = Number(leadUserId)
      if (!Number.isInteger(leadId) || leadId <= 0) {
        setError('please choose team lead user')
        return
      }

      const parsedMembers = members
        .map((item) => ({ user_id: Number(item.user_id), ratio: Number(item.ratio) }))
        .filter(
          (item) =>
            Number.isInteger(item.user_id) && item.user_id > 0 && Number.isFinite(item.ratio) && item.ratio > 0,
        )

      if (parsedMembers.length < 2) {
        setError('team claim requires at least 2 members')
        return
      }
      if (!parsedMembers.some((item) => item.user_id === leadId)) {
        setError('team members must include the lead user')
        return
      }

      const ratioTotal = parsedMembers.reduce((acc, item) => acc + item.ratio, 0)
      if (Math.abs(ratioTotal - 1) > 0.0001) {
        setError('member ratios must sum to 1')
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
      setMessage(`task #${taskId} team claim submitted, claim_id=${res.claim_id}`)
      setMembers(buildDefaultMembers(userId))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'claim failed')
    }
  }

  const savePolicy = async () => {
    if (!canEditPolicy) {
      return
    }
    const threshold = Number(policyDraft)
    if (!Number.isInteger(threshold) || threshold < 1) {
      setError('threshold must be an integer >= 1')
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
      setMessage(`claim approval threshold updated to ${payload.threshold}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'policy update failed')
    } finally {
      setSavingPolicy(false)
    }
  }

  const submitDeliverable = async (event: FormEvent) => {
    event.preventDefault()
    const parsedClaimId = Number(claimId)
    if (!Number.isInteger(parsedClaimId) || parsedClaimId <= 0) {
      setError('please provide valid claim_id')
      return
    }
    try {
      setError(null)
      const attachmentIds = attachments
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item > 0)

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
      setMessage('deliverable submitted')
      setClaimId('')
      setSummary('')
      setAttachments('')
      setCriteriaDrafts([{ key: 'criteria-1', label: 'criteria #1', value: '' }])
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'deliverable submit failed')
    }
  }

  const openTaskDetail = async (taskId: number) => {
    try {
      setError(null)
      const payload = await requestJson<TaskDetail>(`/tasks/${taskId}`, { userId })
      setTaskDetail(payload)
      setDetailOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load task detail')
    }
  }

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>Task Hall</h2>
        <p>Open and in-progress claims, team collaboration, and deliverable submission.</p>
      </header>
      {message && <p className="ok-text">{message}</p>}
      {error && <p className="error-text">{error}</p>}

      {canApproveForOthers && (
        <article className="panel form-grid">
          <h3>Claim Approval Policy</h3>
          <p className="wide muted">
            When overdue count reaches threshold, self-claim is blocked and admin/reviewer can claim on behalf.
          </p>
          <label>
            current threshold
            <input value={policyThreshold ?? '-'} disabled />
          </label>
          <label>
            new threshold
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
                {savingPolicy ? 'saving...' : 'save policy'}
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
        <h3>Task Filters</h3>
        <label>
          level
          <select value={filters.level} onChange={(event) => setFilters((prev) => ({ ...prev, level: event.target.value }))}>
            <option value="">all</option>
            <option value="S">S</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </label>
        <label>
          scenario
          <select value={filters.scenario} onChange={(event) => setFilters((prev) => ({ ...prev, scenario: event.target.value }))}>
            <option value="">all</option>
            <option value="rd">rd</option>
            <option value="ops">ops</option>
            <option value="delivery">delivery</option>
            <option value="support">support</option>
            <option value="other">other</option>
          </select>
        </label>
        <label>
          min reward
          <input type="number" value={filters.rewardMin} onChange={(event) => setFilters((prev) => ({ ...prev, rewardMin: event.target.value }))} />
        </label>
        <label>
          max reward
          <input type="number" value={filters.rewardMax} onChange={(event) => setFilters((prev) => ({ ...prev, rewardMax: event.target.value }))} />
        </label>
        <div className="button-row wide">
          <button className="primary-btn" type="submit">apply filters</button>
          <button type="button" onClick={() => setFilters({ level: '', scenario: '', rewardMin: '', rewardMax: '' })}>reset</button>
        </div>
      </form>

      <article className="panel">
        <div className="panel-headline">
          <h3>Open Tasks</h3>
          <button type="button" onClick={() => void load()}>refresh</button>
        </div>
        <div className="table">
          <div className="row head wide-row">
            <span>ID</span><span>title</span><span>scenario</span><span>level</span><span>reward</span><span>due</span><span>claims</span><span>actions</span>
          </div>
          {openTasks.map((task) => (
            <div className="row wide-row" key={task.id}>
              <span>#{task.id}</span>
              <span>{task.title}</span>
              <span>{task.scenario}</span>
              <span>{task.level}</span>
              <span>CNY {task.reward_total.toFixed(0)}</span>
              <span>{task.due_date}</span>
              <span>{task.active_claim_count}</span>
              <span className="actions">
                <button type="button" onClick={() => void openTaskDetail(task.id)}>detail</button>
                <button type="button" onClick={() => setSelectedTaskId(String(task.id))}>choose</button>
                <button type="button" onClick={() => { setClaimMode('individual'); setSelectedTaskId(String(task.id)) }}>quick claim</button>
              </span>
            </div>
          ))}
        </div>
      </article>

      <form className="panel form-grid" onSubmit={submitClaim}>
        <h3>Claim Setup</h3>
        <label>
          task_id
          <select value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.target.value)} required>
            <option value="">select task</option>
            {claimableTasks.map((task) => (
              <option key={`claim-task-${task.id}`} value={task.id}>
                #{task.id} [{task.status}] {task.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          mode
          <select value={claimMode} onChange={(event) => setClaimMode(event.target.value as ClaimMode)}>
            <option value="individual">individual</option>
            <option value="team">team</option>
          </select>
        </label>

        {(claimMode === 'team' || canApproveForOthers) && (
          <label>
            lead user
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
              <h3>Team Member Ratios (sum = 1)</h3>
              <button type="button" onClick={addMemberRow}>add member</button>
            </div>
            {members.map((item, idx) => (
              <div className="acceptance-editor" key={`member-${idx}`}>
                <label>
                  member
                  <select
                    value={item.user_id}
                    onChange={(event) => setMembers((prev) => prev.map((row, rowIdx) => rowIdx === idx ? { ...row, user_id: event.target.value } : row))}
                  >
                    <option value="">select user</option>
                    {activeUsers.map((user) => (
                      <option key={`member-${idx}-${user.id}`} value={user.id}>#{user.id} {user.name}</option>
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
                    onChange={(event) => setMembers((prev) => prev.map((row, rowIdx) => rowIdx === idx ? { ...row, ratio: event.target.value } : row))}
                  />
                </label>
                <button type="button" onClick={() => removeMemberRow(idx)} disabled={members.length <= 2}>remove</button>
              </div>
            ))}
          </div>
        )}

        <button className="primary-btn" type="submit">submit claim</button>
      </form>

      <article className="panel">
        <h3>In-progress Tasks (with local claim id mapping)</h3>
        <div className="table">
          <div className="row head">
            <span>ID</span><span>title</span><span>scenario</span><span>status</span><span>claims</span><span>claim_id</span>
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
        <h3>Submit Deliverable</h3>
        <label>
          claim_id
          <input value={claimId} onChange={(event) => setClaimId(event.target.value)} required />
        </label>
        <label className="wide">
          summary
          <textarea value={summary} onChange={(event) => setSummary(event.target.value)} required />
        </label>
        <label className="wide">
          evidence attachment IDs (comma separated)
          <input value={attachments} onChange={(event) => setAttachments(event.target.value)} placeholder="e.g. 8,9" />
        </label>
        <div className="wide">
          <div className="panel-headline">
            <h3>Criteria Results</h3>
            <button type="button" onClick={() => void loadClaimCriteria(claimId)} disabled={loadingClaimCriteria}>
              {loadingClaimCriteria ? 'loading...' : 'reload criteria'}
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
                placeholder="describe result for this criteria"
              />
            </label>
          ))}
        </div>
        <button className="primary-btn" type="submit">submit deliverable</button>
      </form>

      {detailOpen && taskDetail && (
        <div className="modal-backdrop" onClick={() => setDetailOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="panel-headline">
              <h3>Task #{taskDetail.id} detail</h3>
              <button type="button" onClick={() => setDetailOpen(false)}>close</button>
            </div>
            <p className="line-metric"><span>title</span><strong>{taskDetail.title}</strong></p>
            <p className="line-metric"><span>goal</span><strong>{taskDetail.goal}</strong></p>
            <p className="line-metric"><span>scope</span><strong>{taskDetail.scope}</strong></p>
            <p className="line-metric"><span>level/status</span><strong>{taskDetail.level} / {taskDetail.status}</strong></p>
            <p className="line-metric"><span>due</span><strong>{taskDetail.due_date}</strong></p>
            <article className="modal-section">
              <h4>acceptance criteria</h4>
              <ul>
                {taskDetail.acceptance_criteria.map((item, idx) => (
                  <li key={`${item.description ?? 'criteria'}-${idx}`}>
                    {item.description ?? 'unnamed criteria'} ({item.type ?? 'unknown'})
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
