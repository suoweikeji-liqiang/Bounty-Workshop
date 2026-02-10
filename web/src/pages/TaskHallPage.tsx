import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import { hasAnyRole } from '../lib/roles'
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
const taskPageSize = 20

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

function buildCriteriaDrafts(detail: ClaimExecutionDetail): CriteriaDraft[] {
  const byResult = detail.criteria_results ?? []
  const criteria = detail.acceptance_criteria ?? []
  if (criteria.length === 0) {
    return [
      {
        key: 'criteria-1',
        label: '楠屾敹椤?#1',
        value: byResult[0] ?? '',
      },
    ]
  }
  return criteria.map((item, idx) => ({
    key: `criteria-${idx + 1}`,
    label: item.description?.trim() || `楠屾敹椤?#${idx + 1}`,
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
  const [attachments, setAttachments] = useState('')
  const [criteriaDrafts, setCriteriaDrafts] = useState<CriteriaDraft[]>([
    { key: 'criteria-1', label: '楠屾敹椤?#1', value: '' },
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
  const [openPage, setOpenPage] = useState(1)
  const [inProgressPage, setInProgressPage] = useState(1)
  const [policyThreshold, setPolicyThreshold] = useState<number | null>(null)
  const [policyDraft, setPolicyDraft] = useState('')
  const [savingPolicy, setSavingPolicy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hasNextOpen = useMemo(() => openTasks.length === taskPageSize, [openTasks.length])
  const hasNextInProgress = useMemo(
    () => inProgressTasks.length === taskPageSize,
    [inProgressTasks.length],
  )

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
      const page = status === 'open' ? openPage : inProgressPage
      const query = new URLSearchParams()
      query.set('status', status)
      query.set('offset', String((Math.max(page, 1) - 1) * taskPageSize))
      query.set('limit', String(taskPageSize))
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
      setError(err instanceof Error ? err.message : '鍔犺浇浠诲姟澶у巺鏁版嵁澶辫触')
    }
  }, [
    filters.level,
    filters.rewardMax,
    filters.rewardMin,
    filters.scenario,
    inProgressPage,
    openPage,
    userId,
  ])

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
      setError(err instanceof Error ? err.message : '鍔犺浇鎻瀹℃壒绛栫暐澶辫触')
    }
  }, [canApproveForOthers, userId])

  const loadClaimCriteria = useCallback(
    async (targetClaimId: string) => {
      const parsed = Number(targetClaimId)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setCriteriaDrafts([{ key: 'criteria-1', label: '楠屾敹椤?#1', value: '' }])
        return
      }
      try {
        setLoadingClaimCriteria(true)
        const detail = await requestJson<ClaimExecutionDetail>(`/claims/${parsed}/detail`, { userId })
        setCriteriaDrafts(buildCriteriaDrafts(detail))
      } catch {
        setCriteriaDrafts([{ key: 'criteria-1', label: '楠屾敹椤?#1', value: '' }])
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
      setError('璇烽€夋嫨瑕佹彮姒滅殑浠诲姟')
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
        setMessage(`浠诲姟 #${taskId} 鎻宸叉彁浜わ紝claim_id=${res.claim_id}`)
        await load()
        return
      }

      const leadId = Number(leadUserId)
      if (!Number.isInteger(leadId) || leadId <= 0) {
        setError('Please select a team lead')
        return
      }

      const parsedMembers = members
        .map((item) => ({ user_id: Number(item.user_id), ratio: Number(item.ratio) }))
        .filter(
          (item) =>
            Number.isInteger(item.user_id) && item.user_id > 0 && Number.isFinite(item.ratio) && item.ratio > 0,
        )

      if (parsedMembers.length < 2) {
        setError('Team claim requires at least two members')
        return
      }
      if (!parsedMembers.some((item) => item.user_id === leadId)) {
        setError('Team members must include the selected lead')
        return
      }

      const ratioTotal = parsedMembers.reduce((acc, item) => acc + item.ratio, 0)
      if (Math.abs(ratioTotal - 1) > 0.0001) {
        setError('鎴愬憳姣斾緥涔嬪拰蹇呴』涓?1')
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
      setMessage(`浠诲姟 #${taskId} 鍥㈤槦鎻宸叉彁浜わ紝claim_id=${res.claim_id}`)
      setMembers(buildDefaultMembers(userId))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '鎻澶辫触')
    }
  }

  const savePolicy = async () => {
    if (!canEditPolicy) {
      return
    }
    const threshold = Number(policyDraft)
    if (!Number.isInteger(threshold) || threshold < 1) {
      setError('Threshold must be an integer greater than or equal to 1')
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
      setMessage(`鎻瀹℃壒闃堝€煎凡鏇存柊涓?${payload.threshold}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '瀹℃壒绛栫暐鏇存柊澶辫触')
    } finally {
      setSavingPolicy(false)
    }
  }

  const submitDeliverable = async (event: FormEvent) => {
    event.preventDefault()
    const parsedClaimId = Number(claimId)
    if (!Number.isInteger(parsedClaimId) || parsedClaimId <= 0) {
      setError('璇疯緭鍏ユ湁鏁堢殑 claim_id')
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
      setMessage('鎴愭灉鎻愪氦鎴愬姛')
      setClaimId('')
      setSummary('')
      setAttachments('')
      setCriteriaDrafts([{ key: 'criteria-1', label: '楠屾敹椤?#1', value: '' }])
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '鎴愭灉鎻愪氦澶辫触')
    }
  }

  const openTaskDetail = async (taskId: number) => {
    try {
      setError(null)
      const payload = await requestJson<TaskDetail>(`/tasks/${taskId}`, { userId })
      setTaskDetail(payload)
      setDetailOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '鍔犺浇浠诲姟璇︽儏澶辫触')
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
        <h2>浠诲姟澶у巺</h2>
        <p>鏌ョ湅鍙彮姒滀笌杩涜涓换鍔★紝鏀寔鍥㈤槦鍗忎綔涓庢垚鏋滄彁浜ゃ€</p>
      </header>

      {canApproveForOthers && (
        <article className="panel form-grid">
          <h3>鎻瀹℃壒绛栫暐</h3>
          <p className="wide muted">
            褰撹秴鏈熸暟閲忚揪鍒伴槇鍊兼椂锛屾櫘閫氱敤鎴峰皢琚檺鍒惰嚜鍔╂彮姒滐紝绠＄悊鍛?璇勫鍙唬涓烘彮姒溿€?          </p>
          <label>
            褰撳墠闃堝€?            <input value={policyThreshold ?? '-'} disabled />
          </label>
          <label>
            鏂伴槇鍊?            <input
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
                {savingPolicy ? '淇濆瓨涓?..' : '淇濆瓨绛栫暐'}
              </button>
            </div>
          )}
        </article>
      )}

      <form
        className="panel form-grid"
        onSubmit={(event) => {
          event.preventDefault()
          if (openPage !== 1 || inProgressPage !== 1) {
            setOpenPage(1)
            setInProgressPage(1)
            return
          }
          void load()
        }}
      >
        <h3>浠诲姟绛涢€</h3>
        <label>
          绛夌骇
          <select value={filters.level} onChange={(event) => setFilters((prev) => ({ ...prev, level: event.target.value }))}>
            <option value="">鍏ㄩ儴</option>
            <option value="S">S</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </label>
        <label>
          鍦烘櫙
          <select value={filters.scenario} onChange={(event) => setFilters((prev) => ({ ...prev, scenario: event.target.value }))}>
            <option value="">鍏ㄩ儴</option>
            <option value="rd">鐮斿彂</option>
            <option value="ops">杩愮淮</option>
            <option value="delivery">浜や粯</option>
            <option value="support">鏀寔</option>
            <option value="other">鍏朵粬</option>
          </select>
        </label>
        <label>
          鏈€浣庡鍔?          <input type="number" value={filters.rewardMin} onChange={(event) => setFilters((prev) => ({ ...prev, rewardMin: event.target.value }))} />
        </label>
        <label>
          鏈€楂樺鍔?          <input type="number" value={filters.rewardMax} onChange={(event) => setFilters((prev) => ({ ...prev, rewardMax: event.target.value }))} />
        </label>
        <div className="button-row wide">
          <button className="primary-btn" type="submit">搴旂敤绛涢€</button>
          <button
            type="button"
            onClick={() => {
              setFilters({ level: '', scenario: '', rewardMin: '', rewardMax: '' })
              setOpenPage(1)
              setInProgressPage(1)
            }}
          >
            重置
          </button>
        </div>
      </form>

      <article className="panel">
        <div className="panel-headline">
          <h3>鍙彮姒滀换鍔</h3>
          <button type="button" onClick={() => void load()}>鍒锋柊</button>
        </div>
        <div className="table">
          <div className="row head wide-row">
            <span>ID</span><span>鏍囬</span><span>鍦烘櫙</span><span>绛夌骇</span><span>濂栧姳</span><span>鎴鏃ユ湡</span><span>鎻鏁</span><span>鎿嶄綔</span>
          </div>
          {openTasks.map((task) => (
            <div className="row wide-row" key={task.id}>
              <span>#{task.id}</span>
              <span>{task.title}</span>
              <span>{task.scenario}</span>
              <span>{task.level}</span>
              <span>楼{task.reward_total.toFixed(0)}</span>
              <span>{task.due_date}</span>
              <span>{task.active_claim_count}</span>
              <span className="actions">
                <button type="button" onClick={() => void openTaskDetail(task.id)}>璇︽儏</button>
                <button type="button" onClick={() => setSelectedTaskId(String(task.id))}>閫夋嫨</button>
                <button type="button" onClick={() => { setClaimMode('individual'); setSelectedTaskId(String(task.id)) }}>蹇€熸彮姒</button>
              </span>
            </div>
          ))}
        </div>
        <div className="button-row">
          <button type="button" onClick={() => setOpenPage((prev) => Math.max(prev - 1, 1))} disabled={openPage <= 1}>
            上一页
          </button>
          <span className="muted">第 {openPage} 页</span>
          <button type="button" onClick={() => setOpenPage((prev) => prev + 1)} disabled={!hasNextOpen}>
            下一页
          </button>
        </div>
      </article>

      <form className="panel form-grid" onSubmit={submitClaim}>
        <h3>鎻璁剧疆</h3>
        <label>
          浠诲姟 ID
          <select value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.target.value)} required>
            <option value="">璇烽€夋嫨浠诲姟</option>
            {claimableTasks.map((task) => (
              <option key={`claim-task-${task.id}`} value={task.id}>
                #{task.id} [{task.status}] {task.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          妯″紡
          <select value={claimMode} onChange={(event) => setClaimMode(event.target.value as ClaimMode)}>
            <option value="individual">涓汉</option>
            <option value="team">鍥㈤槦</option>
          </select>
        </label>

        {(claimMode === 'team' || canApproveForOthers) && (
          <label>
            璐熻矗浜?            <select value={leadUserId} onChange={(event) => setLeadUserId(event.target.value)} required>
              {visibleLeadUsers.map((user) => (
                <option key={`lead-${user.id}`} value={user.id}>#{user.id} {user.name}</option>
              ))}
            </select>
          </label>
        )}

        {claimMode === 'team' && (
          <div className="wide">
            <div className="panel-headline">
              <h3>鍥㈤槦鎴愬憳姣斾緥锛堟€诲拰 = 1锛</h3>
              <button type="button" onClick={addMemberRow}>鏂板鎴愬憳</button>
            </div>
            {members.map((item, idx) => (
              <div className="acceptance-editor" key={`member-${idx}`}>
                <label>
                  鎴愬憳
                  <select
                    value={item.user_id}
                    onChange={(event) => setMembers((prev) => prev.map((row, rowIdx) => rowIdx === idx ? { ...row, user_id: event.target.value } : row))}
                  >
                    <option value="">璇烽€夋嫨鎴愬憳</option>
                    {activeUsers.map((user) => (
                      <option key={`member-${idx}-${user.id}`} value={user.id}>#{user.id} {user.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  姣斾緥
                  <input
                    type="number"
                    min="0.01"
                    max="1"
                    step="0.01"
                    value={item.ratio}
                    onChange={(event) => setMembers((prev) => prev.map((row, rowIdx) => rowIdx === idx ? { ...row, ratio: event.target.value } : row))}
                  />
                </label>
                <button type="button" onClick={() => removeMemberRow(idx)} disabled={members.length <= 2}>绉婚櫎</button>
              </div>
            ))}
          </div>
        )}

        <button className="primary-btn" type="submit">鎻愪氦鎻</button>
      </form>

      <article className="panel">
        <h3>杩涜涓换鍔★紙鍚湰鍦?claim_id 鏄犲皠锛</h3>
        <div className="table">
          <div className="row head">
            <span>ID</span><span>鏍囬</span><span>鍦烘櫙</span><span>鐘舵€</span><span>鎻鏁</span><span>鎻 ID</span>
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
        <div className="button-row">
          <button
            type="button"
            onClick={() => setInProgressPage((prev) => Math.max(prev - 1, 1))}
            disabled={inProgressPage <= 1}
          >
            上一页
          </button>
          <span className="muted">第 {inProgressPage} 页</span>
          <button
            type="button"
            onClick={() => setInProgressPage((prev) => prev + 1)}
            disabled={!hasNextInProgress}
          >
            下一页
          </button>
        </div>
      </article>

      <form className="panel form-grid" onSubmit={submitDeliverable}>
        <h3>鎻愪氦鎴愭灉</h3>
        <label>
          鎻 ID锛坈laim_id锛?          <input value={claimId} onChange={(event) => setClaimId(event.target.value)} required />
        </label>
        <label className="wide">
          鎴愭灉璇存槑
          <textarea value={summary} onChange={(event) => setSummary(event.target.value)} required />
        </label>
        <label className="wide">
          璇佹嵁闄勪欢 ID锛堥€楀彿鍒嗛殧锛?          <input value={attachments} onChange={(event) => setAttachments(event.target.value)} placeholder="渚嬪锛?,9" />
        </label>
        <div className="wide">
          <div className="panel-headline">
            <h3>楠屾敹椤圭粨鏋</h3>
            <button type="button" onClick={() => void loadClaimCriteria(claimId)} disabled={loadingClaimCriteria}>
              {loadingClaimCriteria ? 'Loading...' : 'Reload Criteria'}
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
                placeholder="Describe the result for this criterion"
              />
            </label>
          ))}
        </div>
        <button className="primary-btn" type="submit">鎻愪氦鎴愭灉</button>
      </form>

      {detailOpen && taskDetail && (
        <div className="modal-backdrop" onClick={() => setDetailOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="panel-headline">
              <h3>浠诲姟 #{taskDetail.id} 璇︽儏</h3>
              <button type="button" onClick={() => setDetailOpen(false)}>鍏抽棴</button>
            </div>
            <p className="line-metric"><span>鏍囬</span><strong>{taskDetail.title}</strong></p>
            <p className="line-metric"><span>鐩爣</span><strong>{taskDetail.goal}</strong></p>
            <p className="line-metric"><span>鑼冨洿</span><strong>{taskDetail.scope}</strong></p>
            <p className="line-metric"><span>绛夌骇/鐘舵€</span><strong>{taskDetail.level} / {taskDetail.status}</strong></p>
            <p className="line-metric"><span>鎴鏃ユ湡</span><strong>{taskDetail.due_date}</strong></p>
            <article className="modal-section">
              <h4>楠屾敹鏍囧噯</h4>
              <ul>
                {taskDetail.acceptance_criteria.map((item, idx) => (
                  <li key={`${item.description ?? 'criteria'}-${idx}`}>
                    {item.description ?? '鏈懡鍚嶉獙鏀堕」'} ({item.type ?? '鏈煡'})
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

