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
  const [filterDraft, setFilterDraft] = useState<RewardFilter>('generated')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [detailRewardId, setDetailRewardId] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hasNext = useMemo(() => rows.length === rewardPageSize, [rows.length])
  const selectedReward = useMemo(() => rows.find((item) => item.id === detailRewardId) ?? null, [rows, detailRewardId])
  const hasFilterChanges = filter !== filterDraft

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
    try {
      setConfirmingId(reward.id)
      await requestJson(`/rewards/${reward.id}/confirm`, {
        method: 'POST',
        userId,
      })
      setMessage(`奖励 #${reward.id} 已确认`)
      setDetailRewardId(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '奖励确认失败')
    } finally {
      setConfirmingId(null)
    }
  }

  const applyFilter = () => {
    setPage(1)
    setFilter(filterDraft)
  }

  const resetFilter = () => {
    setFilterDraft('generated')
    setFilter('generated')
    setPage(1)
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

      <article className="panel filter-panel">
        <div className="panel-headline">
          <h3>筛选条件</h3>
        </div>
        <div className="filter-toolbar">
          <label className="filter-field">
            <span>奖励状态</span>
            <select value={filterDraft} onChange={(event) => setFilterDraft(event.target.value as RewardFilter)}>
              <option value="generated">待确认</option>
              <option value="confirmed">已确认</option>
              <option value="all">全部</option>
            </select>
          </label>
          <div className="filter-actions">
            <button className="primary-btn" type="button" onClick={applyFilter} disabled={loading || !hasFilterChanges}>
              应用筛选
            </button>
            <button type="button" onClick={resetFilter} disabled={loading}>
              重置
            </button>
            <button type="button" onClick={() => void load()} disabled={loading}>
              {loading ? '加载中...' : '刷新'}
            </button>
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-headline">
          <h3>
            奖励记录（第 {page} 页 / 当前筛选：{filter === 'all' ? '全部' : formatStatus(filter)}）
          </h3>
          <span className="muted">{rows.length} 条</span>
        </div>
        <div className="table">
          <div className="row head reward-row">
            <span>ID</span>
            <span>任务</span>
            <span>用户</span>
            <span>角色</span>
            <span>金额</span>
            <span>状态</span>
            <span>操作</span>
          </div>
          {rows.length === 0 && (
            <div className="row reward-row">
              <span style={{ gridColumn: '1 / -1', textAlign: 'center' }}>当前筛选条件下暂无奖励记录</span>
            </div>
          )}
          {rows.map((item) => (
            <div className="row reward-row" key={item.id}>
              <span>#{item.id}</span>
              <span title={item.task_title ?? undefined}>{item.task_title ? `${item.task_title} (#${item.task_id})` : `#${item.task_id}`}</span>
              <span title={item.user_name ?? undefined}>{item.user_name ? `${item.user_name} (#${item.user_id})` : `#${item.user_id}`}</span>
              <span>{formatRoleType(item.role_type)}</span>
              <span>￥{item.amount.toFixed(2)}</span>
              <span>
                <StatusBadge tone={rewardTone(item.status)}>{formatStatus(item.status)}</StatusBadge>
              </span>
              <span className="actions">
                <button type="button" onClick={() => setDetailRewardId(item.id)}>
                  查看详情
                </button>
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

      {selectedReward && (
        <div className="modal-backdrop" onClick={() => setDetailRewardId(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="reward-detail-title">
            <div className="panel-headline">
              <h3 id="reward-detail-title">奖励详情 #{selectedReward.id}</h3>
              <button type="button" onClick={() => setDetailRewardId(null)}>
                关闭
              </button>
            </div>
            <p className="line-metric">
              <span>任务</span>
              <strong>{selectedReward.task_title ? `${selectedReward.task_title} (#${selectedReward.task_id})` : `#${selectedReward.task_id}`}</strong>
            </p>
            <p className="line-metric">
              <span>用户</span>
              <strong>{selectedReward.user_name ? `${selectedReward.user_name} (#${selectedReward.user_id})` : `#${selectedReward.user_id}`}</strong>
            </p>
            <p className="line-metric">
              <span>角色</span>
              <strong>{formatRoleType(selectedReward.role_type)}</strong>
            </p>
            <p className="line-metric">
              <span>金额 / 积分 / 徽章</span>
              <strong>
                ￥{selectedReward.amount.toFixed(2)} / {selectedReward.points} / {selectedReward.badge ?? '-'}
              </strong>
            </p>
            <p className="line-metric">
              <span>状态</span>
              <strong>{formatStatus(selectedReward.status)}</strong>
            </p>
            <p className="line-metric">
              <span>确认时间</span>
              <strong>{selectedReward.confirmed_at ? new Date(selectedReward.confirmed_at).toLocaleString() : '-'}</strong>
            </p>
            <div className="button-row">
              <button type="button" onClick={() => setDetailRewardId(null)}>
                返回列表
              </button>
              {selectedReward.status === 'generated' && (
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => void confirmReward(selectedReward)}
                  disabled={confirmingId === selectedReward.id}
                >
                  {confirmingId === selectedReward.id ? '确认中...' : '确认发放'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

