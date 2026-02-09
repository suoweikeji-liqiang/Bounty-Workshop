import { useCallback, useEffect, useMemo, useState } from 'react'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { PersonalSummary } from '../types'

type Props = {
  userId: number
}

export function PersonalCenterPage({ userId }: Props) {
  const toast = useToast()
  const [summary, setSummary] = useState<PersonalSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setError(null)
      const payload = await requestJson<PersonalSummary>('/me/summary', { userId })
      setSummary(payload)
    } catch (err) {
      setSummary(null)
      setError(err instanceof Error ? err.message : 'failed to load personal summary')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  const badgeList = useMemo(() => summary?.badges ?? [], [summary])
  const rewards = useMemo(() => summary?.rewards ?? [], [summary])

  useEffect(() => {
    if (!error) {
      return
    }
    toast.error(error)
  }, [error, toast])

  return (
    <section className="page-wrap personal-page">
      <header className="page-head personal-head">
        <div>
          <h2>Personal Center</h2>
          <p>Profile, points, badges, and reward history in one place.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'loading...' : 'refresh'}
        </button>
      </header>

      {summary && (
        <>
          <article className="personal-hero">
            <p className="personal-kicker">Current account</p>
            <h3>{summary.user.name}</h3>
            <p className="muted">
              #{summary.user.id}
              {summary.user.department ? ` | ${summary.user.department}` : ''}
              {summary.user.employee_no ? ` | ${summary.user.employee_no}` : ''}
            </p>
            <div className="personal-meta">
              <span>status: {summary.user.status}</span>
              <span>overdue count: {summary.user.overdue_count}</span>
              <span>roles: {summary.user.roles.join(', ')}</span>
            </div>
          </article>

          <div className="kpi-grid personal-kpis">
            <article className="kpi-card personal-kpi">
              <h4>Total reward records</h4>
              <strong>{summary.stats.total_records}</strong>
            </article>
            <article className="kpi-card personal-kpi">
              <h4>Confirmed rewards</h4>
              <strong>{summary.stats.confirmed_records}</strong>
            </article>
            <article className="kpi-card personal-kpi">
              <h4>Confirmed amount</h4>
              <strong>CNY {summary.stats.confirmed_reward_amount.toFixed(2)}</strong>
            </article>
            <article className="kpi-card personal-kpi">
              <h4>Total points</h4>
              <strong>{summary.stats.total_points}</strong>
            </article>
            <article className="kpi-card personal-kpi">
              <h4>Confirmed points</h4>
              <strong>{summary.stats.confirmed_points}</strong>
            </article>
          </div>

          <article className="panel">
            <h3>Badges</h3>
            {badgeList.length === 0 ? (
              <p className="muted">No confirmed badges yet.</p>
            ) : (
              <div className="personal-badges">
                {badgeList.map((badge) => (
                  <span className="personal-badge" key={badge}>
                    {badge}
                  </span>
                ))}
              </div>
            )}
          </article>

          <article className="panel">
            <h3>Reward History</h3>
            {rewards.length === 0 ? (
              <p className="muted">No reward records yet.</p>
            ) : (
              <div className="table">
                <div className="row head wide-row personal-row">
                  <span>reward</span>
                  <span>task</span>
                  <span>role</span>
                  <span>amount</span>
                  <span>points</span>
                  <span>badge</span>
                  <span>status</span>
                  <span>confirmed at</span>
                </div>
                {rewards.map((item) => (
                  <div className="row wide-row personal-row" key={item.id}>
                    <span>#{item.id}</span>
                    <span>#{item.task_id}</span>
                    <span>{item.role_type}</span>
                    <span>CNY {item.amount.toFixed(2)}</span>
                    <span>{item.points}</span>
                    <span>{item.badge ?? '-'}</span>
                    <span>{item.status}</span>
                    <span>{item.confirmed_at ? new Date(item.confirmed_at).toLocaleString() : '-'}</span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </>
      )}
    </section>
  )
}
