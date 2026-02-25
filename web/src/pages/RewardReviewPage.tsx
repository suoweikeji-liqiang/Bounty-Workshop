import { useCallback, useEffect, useMemo, useState } from 'react'

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

export function RewardReviewPage({ userId, profile }: Props) {
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
      setError(err instanceof Error ? err.message : 'Failed to load rewards')
    } finally {
      setLoading(false)
    }
  }, [filter, page, userId])

  useEffect(() => {
    void load()
  }, [load])

  const confirmReward = async (reward: Reward) => {
    try {
      await requestJson(`/rewards/${reward.id}/confirm`, {
        method: 'POST',
        userId,
      })
      setMessage(`Reward #${reward.id} confirmed`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm reward')
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
        <h2>婵€鍔卞鏍</h2>
        <p>鏌ョ湅缁堣瘎鑱斿姩鍚庣殑婵€鍔辩姸鎬侊紝澶勭悊鍐荤粨婵€鍔辩殑澶嶆牳纭銆</p>
      </header>

      <article className="panel form-grid">
        <label>
          绛涢€?          <select value={filter} onChange={(event) => { setFilter(event.target.value as RewardFilter); setPage(1) }}>
            <option value="generated">寰呯'璁</option>
            <option value="confirmed">宸茬'璁</option>
            <option value="all">鍏ㄩ儴</option>
          </select>
        </label>
        <div className="button-row">
          <button type="button" onClick={() => void load()} disabled={loading}>
            {loading ? '鍔犺浇涓?..' : '鍒锋柊'}
          </button>
        </div>
      </article>

      <article className="panel">
        <div className="table">
          <div className="row head wide-row">
            <span>ID</span>
            <span>浠诲姟</span>
            <span>鐢ㄦ埛</span>
            <span>瑙掕壊</span>
            <span>閲戦</span>
            <span>鐘舵€</span>
            <span>鎿嶄綔</span>
          </div>
          {rows.map((item) => (
            <div className="row wide-row" key={item.id}>
              <span>#{item.id}</span>
              <span>#{item.task_id}</span>
              <span>#{item.user_id}</span>
              <span>{item.role_type}</span>
              <span>楼{item.amount.toFixed(2)}</span>
              <span>{item.status}</span>
              <span>
                {item.status === 'generated' ? (
                  <button type="button" onClick={() => void confirmReward(item)}>
                    confirm
                  </button>
                ) : (
                  'Confirmed'
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

