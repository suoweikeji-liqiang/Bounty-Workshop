import { useCallback, useEffect, useMemo, useState } from 'react'

import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { Reward, UserProfile } from '../types'

type Props = {
  userId: number
  profile: UserProfile | null
}

type RewardFilter = 'all' | 'generated' | 'confirmed'
const rewardPageSize = 20

function buildQuery(filter: RewardFilter, page: number) {
  const params = new URLSearchParams()
  params.set('offset', String((Math.max(page, 1) - 1) * rewardPageSize))
  params.set('limit', String(rewardPageSize))
  if (filter === 'generated' || filter === 'confirmed') {
    params.set('status', filter)
  }
  const query = params.toString()
  return query ? `/rewards?${query}` : '/rewards'
}

function formatStatus(status: string) {
  if (status === 'generated') return '待确认'
  if (status === 'confirmed') return '已确认'
  return status
}

function rewardTone(status: string): 'success' | 'warn' | 'danger' | 'info' | 'muted' {
  if (status === 'confirmed') return 'success'
  if (status === 'generated') return 'warn'
  return 'muted'
}

function formatRoleType(roleType: string) {
  if (roleType === 'proposer') return '问题提交人'
  if (roleType === 'executor') return '揭榜执行人'
  return roleType
}

export function RewardReviewPage({ userId, profile: _profile }: Props) {
  const toast = useToast()
  const [rows, setRows] = useState<Reward[]>([])
  const [filter, setFilter] = useState<RewardFilter>('generated')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hasNext = useMemo(() => rows.length === rewardPageSize, [rows.length])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const payload = await requestJson<Reward[]>(buildQuery(filter, page), { userId })
      setRows(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载奖励列表失败')
    } finally {
      setLoading(false)
    }
  }, [filter, page, userId])

  useEffect(() => {
    void load()
  }, [load])

  const confirmReward = async (reward: Reward) => {
    const ok = window.confirm(`确认发放奖励 #${reward.id} 吗？该操作不可撤销。`)
    if (!ok) {
      return
    }

    try {
      await requestJson(`/rewards/${reward.id}/confirm`, {
        method: 'POST',
        userId,
      })
      setMessage(`奖励 #${reward.id} 已确认`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '奖励确认失败')
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
        <h2>奖励复核</h2>
        <p>查看奖励记录并确认发放状态。</p>
      </header>

      <article className="panel form-grid">
        <label>
          筛选
          <select
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value as RewardFilter)
              setPage(1)
            }}
          >
            <option value="generated">待确认</option>
            <option value="confirmed">已确认</option>
            <option value="all">全部</option>
          </select>
        </label>
        <div className="button-row">
          <button type="button" onClick={() => void load()} disabled={loading}>
            {loading ? '加载中...' : '刷新'}
          </button>
        </div>
      </article>

      <article className="panel">
        <div className="table">
          <div className="row head wide-row">
            <span>ID</span>
            <span>任务</span>
            <span>用户</span>
            <span>角色</span>
            <span>金额</span>
            <span>状态</span>
            <span>操作</span>
          </div>
          {rows.map((item) => (
            <div className="row wide-row" key={item.id}>
              <span>#{item.id}</span>
              <span>#{item.task_id}</span>
              <span>#{item.user_id}</span>
              <span>{formatRoleType(item.role_type)}</span>
              <span>¥{item.amount.toFixed(2)}</span>
              <span>
                <StatusBadge tone={rewardTone(item.status)}>{formatStatus(item.status)}</StatusBadge>
              </span>
              <span>
                {item.status === 'generated' ? (
                  <button type="button" onClick={() => void confirmReward(item)}>
                    确认发放
                  </button>
                ) : (
                  '已确认'
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="button-row">
          <button type="button" onClick={() => setPage((prev) => Math.max(prev - 1, 1))} disabled={page <= 1 || loading}>
            上一页
          </button>
          <span className="muted">第 {page} 页</span>
          <button type="button" onClick={() => setPage((prev) => prev + 1)} disabled={!hasNext || loading}>
            下一页
          </button>
        </div>
      </article>
    </section>
  )
}
