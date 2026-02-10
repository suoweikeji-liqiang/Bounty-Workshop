import { useEffect, useMemo, useState } from 'react'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { Distribution, Overview, RankingItem, Rankings, Trends } from '../types'

type Props = {
  userId: number
}

function RankingList({ title, items }: { title: string; items: RankingItem[] }) {
  return (
    <article className="panel">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="muted">暂无数据</p>
      ) : (
        <ol className="ranking-list">
          {items.slice(0, 8).map((item) => (
            <li key={`${title}-${item.user_id}`}>
              <span className="label">{item.user_name}</span>
              <strong>{item.value.toFixed(0)}</strong>
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}

export function DashboardPage({ userId }: Props) {
  const toast = useToast()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [rankings, setRankings] = useState<Rankings | null>(null)
  const [trends, setTrends] = useState<Trends | null>(null)
  const [distribution, setDistribution] = useState<Distribution | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const run = async () => {
      try {
        setError(null)
        const [o, r, t, d] = await Promise.all([
          requestJson<Overview>('/dashboard/overview', { userId }),
          requestJson<Rankings>('/dashboard/rankings?time_range=all&top_n=10', { userId }),
          requestJson<Trends>('/dashboard/trends?time_range=all&granularity=month', { userId }),
          requestJson<Distribution>('/dashboard/distribution?time_range=all', { userId }),
        ])
        setOverview(o)
        setRankings(r)
        setTrends(t)
        setDistribution(d)
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败')
      }
    }
    void run()
  }, [userId])

  const trendMax = useMemo(() => {
    if (!trends || trends.points.length === 0) {
      return 1
    }
    return Math.max(...trends.points.map((point) => point.problem_submitted + point.task_completed))
  }, [trends])

  useEffect(() => {
    if (!error) {
      return
    }
    toast.error(error)
  }, [error, toast])

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>作战看板</h2>
        <p>问题、任务与激励的全链路状态。</p>
      </header>
      <div className="kpi-grid">
        <article className="kpi-card">
          <h4>问题总数</h4>
          <strong>{overview?.problem_total ?? '-'}</strong>
        </article>
        <article className="kpi-card">
          <h4>已立项问题</h4>
          <strong>{overview?.problem_approved ?? '-'}</strong>
        </article>
        <article className="kpi-card">
          <h4>任务总数</h4>
          <strong>{overview?.task_total ?? '-'}</strong>
        </article>
        <article className="kpi-card">
          <h4>任务完成数</h4>
          <strong>{overview?.task_completed ?? '-'}</strong>
        </article>
        <article className="kpi-card">
          <h4>超期揭榜数</h4>
          <strong>{overview?.task_overdue_claims ?? '-'}</strong>
        </article>
        <article className="kpi-card">
          <h4>任务完成率</h4>
          <strong>{overview ? `${(overview.task_completion_rate * 100).toFixed(1)}%` : '-'}</strong>
        </article>
        <article className="kpi-card">
          <h4>任务超期率</h4>
          <strong>{overview ? `${(overview.task_overdue_rate * 100).toFixed(1)}%` : '-'}</strong>
        </article>
        <article className="kpi-card">
          <h4>已发放激励</h4>
          <strong>¥{overview?.reward_total_confirmed_amount?.toFixed(2) ?? '-'}</strong>
        </article>
        <article className="kpi-card">
          <h4>终评快照数</h4>
          <strong>{overview?.performance_review_count ?? '-'}</strong>
        </article>
        <article className="kpi-card">
          <h4>失职快照数</h4>
          <strong>{overview?.performance_fault_count ?? '-'}</strong>
        </article>
        <article className="kpi-card">
          <h4>激励冻结数</h4>
          <strong>{overview?.reward_hold_count ?? '-'}</strong>
        </article>
      </div>
      <div className="panel-grid">
        <RankingList title="揭榜排行" items={rankings?.claim_count_ranking ?? []} />
        <RankingList title="激励排行" items={rankings?.reward_amount_ranking ?? []} />
        <RankingList title="问题贡献排行" items={rankings?.problem_contribution_ranking ?? []} />
        <RankingList title="积分排行" items={rankings?.points_ranking ?? []} />
      </div>
      <div className="panel-grid single">
        <article className="panel">
          <h3>趋势</h3>
          <div className="trend-list">
            {(trends?.points ?? []).slice(-8).map((point) => {
              const score = point.problem_submitted + point.task_completed
              const width = `${(score / trendMax) * 100}%`
              return (
                <div className="trend-row" key={point.period}>
                  <span className="period">{point.period}</span>
                  <div className="bar">
                    <i style={{ width }} />
                  </div>
                  <span className="value">
                    P{point.problem_submitted} / T{point.task_completed}
                  </span>
                </div>
              )
            })}
          </div>
        </article>
      </div>
      <div className="panel-grid">
        <article className="panel">
          <h3>场景分布</h3>
          {(distribution?.scenario_distribution ?? []).map((item) => (
            <p key={item.name} className="line-metric">
              <span>{item.name}</span>
              <strong>{item.count}</strong>
            </p>
          ))}
        </article>
        <article className="panel">
          <h3>等级分布</h3>
          {(distribution?.level_distribution ?? []).map((item) => (
            <p key={item.name} className="line-metric">
              <span>{item.name}</span>
              <strong>{item.count}</strong>
            </p>
          ))}
        </article>
        <article className="panel">
          <h3>部门分布</h3>
          {(distribution?.department_distribution ?? []).map((item) => (
            <p key={item.name} className="line-metric">
              <span>{item.name}</span>
              <strong>{item.count}</strong>
            </p>
          ))}
        </article>
        <article className="panel">
          <h3>基础履责分布</h3>
          {(distribution?.baseline_responsibility_distribution ?? []).map((item) => (
            <p key={item.name} className="line-metric">
              <span>{item.name}</span>
              <strong>{item.count}</strong>
            </p>
          ))}
        </article>
        <article className="panel">
          <h3>终评 R 分布</h3>
          {(distribution?.final_r_level_distribution ?? []).map((item) => (
            <p key={item.name} className="line-metric">
              <span>{item.name}</span>
              <strong>{item.count}</strong>
            </p>
          ))}
        </article>
      </div>
    </section>
  )
}
