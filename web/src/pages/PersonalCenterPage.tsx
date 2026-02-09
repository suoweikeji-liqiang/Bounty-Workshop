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
      setError(err instanceof Error ? err.message : '加载个人中心数据失败')
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
          <h2>个人中心</h2>
          <p>集中查看个人信息、积分、徽章与激励历史。</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? '加载中...' : '刷新'}
        </button>
      </header>

      {summary && (
        <>
          <article className="personal-hero">
            <p className="personal-kicker">当前账号</p>
            <h3>{summary.user.name}</h3>
            <p className="muted">
              #{summary.user.id}
              {summary.user.department ? ` | ${summary.user.department}` : ''}
              {summary.user.employee_no ? ` | ${summary.user.employee_no}` : ''}
            </p>
            <div className="personal-meta">
              <span>状态：{summary.user.status}</span>
              <span>超期次数：{summary.user.overdue_count}</span>
              <span>角色：{summary.user.roles.join(', ')}</span>
            </div>
          </article>

          <div className="kpi-grid personal-kpis">
            <article className="kpi-card personal-kpi">
              <h4>激励总记录</h4>
              <strong>{summary.stats.total_records}</strong>
            </article>
            <article className="kpi-card personal-kpi">
              <h4>已确认激励</h4>
              <strong>{summary.stats.confirmed_records}</strong>
            </article>
            <article className="kpi-card personal-kpi">
              <h4>已确认金额</h4>
              <strong>¥ {summary.stats.confirmed_reward_amount.toFixed(2)}</strong>
            </article>
            <article className="kpi-card personal-kpi">
              <h4>总积分</h4>
              <strong>{summary.stats.total_points}</strong>
            </article>
            <article className="kpi-card personal-kpi">
              <h4>已确认积分</h4>
              <strong>{summary.stats.confirmed_points}</strong>
            </article>
          </div>

          <article className="panel">
            <h3>徽章</h3>
            {badgeList.length === 0 ? (
              <p className="muted">暂无已确认徽章。</p>
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
            <h3>激励历史</h3>
            {rewards.length === 0 ? (
              <p className="muted">暂无激励记录。</p>
            ) : (
              <div className="table">
                <div className="row head wide-row personal-row">
                  <span>激励</span>
                  <span>任务</span>
                  <span>角色</span>
                  <span>金额</span>
                  <span>积分</span>
                  <span>徽章</span>
                  <span>状态</span>
                  <span>确认时间</span>
                </div>
                {rewards.map((item) => (
                  <div className="row wide-row personal-row" key={item.id}>
                    <span>#{item.id}</span>
                    <span>#{item.task_id}</span>
                    <span>{item.role_type}</span>
                    <span>¥ {item.amount.toFixed(2)}</span>
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
