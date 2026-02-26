import { useCallback, useEffect, useMemo, useState } from 'react'

import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { PersonalSummary } from '../types'

type Props = {
  userId: number
}

const roleLabelMap: Record<string, string> = {
  admin: '管理员',
  reviewer: '审核人',
  reward_approver: '资金复核人',
  acceptor: '验收人',
  employee: '员工',
}

const userStatusLabelMap: Record<string, string> = {
  enabled: '启用',
  disabled: '禁用',
}

const rewardRoleLabelMap: Record<string, string> = {
  proposer: '问题提交人',
  executor: '执行人',
}

const rewardStatusLabelMap: Record<string, string> = {
  generated: '待确认',
  confirmed: '已确认',
}

function formatRole(role: string) {
  return roleLabelMap[role] ?? role
}

function formatUserStatus(status: string) {
  return userStatusLabelMap[status] ?? status
}

function formatRewardRole(roleType: string) {
  return rewardRoleLabelMap[roleType] ?? roleType
}

function formatRewardStatus(status: string) {
  return rewardStatusLabelMap[status] ?? status
}

function rewardTone(status: string): 'success' | 'warn' | 'danger' | 'info' | 'muted' {
  if (status === 'confirmed') return 'success'
  if (status === 'generated') return 'warn'
  return 'muted'
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

  const badgeList = useMemo(() => summary?.badge_details ?? [], [summary])
  const rewards = useMemo(() => summary?.rewards ?? [], [summary])

  useEffect(() => {
    if (!error) return
    toast.error(error)
  }, [error, toast])

  return (
    <section className="page-wrap personal-page">
      <header className="page-head personal-head">
        <div>
          <h2>个人中心</h2>
          <p>集中查看个人信息、积分、徽章与激励记录。</p>
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
            <p className="personal-id-line">
              #{summary.user.id}
              {summary.user.department ? ` | ${summary.user.department}` : ''}
              {summary.user.employee_no ? ` | 工号 ${summary.user.employee_no}` : ''}
            </p>
            <div className="personal-meta">
              <span className="personal-meta-pill">
                <b>状态</b>
                {formatUserStatus(summary.user.status)}
              </span>
              <span className="personal-meta-pill">
                <b>超期次数</b>
                {summary.user.overdue_count}
              </span>
              <span className="personal-meta-pill">
                <b>角色</b>
                {summary.user.roles.map(formatRole).join('、')}
              </span>
            </div>
          </article>

          <div className="kpi-grid personal-kpis">
            <article className="kpi-card personal-kpi">
              <h4>激励总记录</h4>
              <strong>{summary.stats.total_records}</strong>
            </article>
            <article className="kpi-card personal-kpi">
              <h4>已确认记录</h4>
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
              <p className="muted">暂无已授予徽章。</p>
            ) : (
              <div className="table">
                <div className="row head wide-row">
                  <span>徽章</span>
                  <span>编码</span>
                  <span>类别</span>
                  <span>说明</span>
                  <span>来源</span>
                  <span>获得时间</span>
                </div>
                {badgeList.map((badge) => (
                  <div className="row wide-row" key={`${badge.code}-${badge.earned_at}`}>
                    <span>{badge.name}</span>
                    <span>{badge.icon} / {badge.code}</span>
                    <span>{badge.category}</span>
                    <span>{badge.description}</span>
                    <span>{badge.source_type}</span>
                    <span>{new Date(badge.earned_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="panel">
            <h3>激励记录</h3>
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
                    <span>{formatRewardRole(item.role_type)}</span>
                    <span>¥ {item.amount.toFixed(2)}</span>
                    <span>{item.points}</span>
                    <span>{item.badge ?? '-'}</span>
                    <span>
                      <StatusBadge tone={rewardTone(item.status)}>{formatRewardStatus(item.status)}</StatusBadge>
                    </span>
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
