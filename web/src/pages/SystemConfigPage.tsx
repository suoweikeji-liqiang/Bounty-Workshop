import { useCallback, useEffect, useMemo, useState } from 'react'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type {
  AcceptanceTemplatesConfig,
  BudgetReviewThresholdConfig,
  ClaimApprovalThresholdConfig,
  SyncFrequencyConfig,
  SystemConfigOverview,
} from '../types'

type Props = {
  userId: number
}

type ConfigSection = 'sync' | 'threshold' | 'templates' | 'ops'

function parseTemplateLines(text: string): string[] {
  return text
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function SystemConfigPage({ userId }: Props) {
  const toast = useToast()
  const [activeSection, setActiveSection] = useState<ConfigSection>('sync')
  const [overview, setOverview] = useState<SystemConfigOverview | null>(null)

  const [feishuFreq, setFeishuFreq] = useState('')
  const [releaseFreq, setReleaseFreq] = useState('')
  const [claimThreshold, setClaimThreshold] = useState('')
  const [budgetThreshold, setBudgetThreshold] = useState('')
  const [approvedTemplates, setApprovedTemplates] = useState('')
  const [reworkTemplates, setReworkTemplates] = useState('')
  const [rejectedTemplates, setRejectedTemplates] = useState('')

  const [loading, setLoading] = useState(false)
  const [savingSync, setSavingSync] = useState(false)
  const [savingThreshold, setSavingThreshold] = useState(false)
  const [savingTemplates, setSavingTemplates] = useState(false)
  const [releasing, setReleasing] = useState(false)
  const [confirmReleaseOpen, setConfirmReleaseOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hasSyncChanges = useMemo(() => {
    if (!overview) return false
    return (
      Number(feishuFreq) !== overview.feishu_sync_frequency_minutes ||
      Number(releaseFreq) !== overview.release_overdue_frequency_minutes
    )
  }, [feishuFreq, overview, releaseFreq])

  const hasThresholdChanges = useMemo(() => {
    if (!overview) return false
    return (
      Number(claimThreshold) !== overview.claim_approval_overdue_threshold ||
      Number(budgetThreshold) !== overview.budget_review_threshold
    )
  }, [budgetThreshold, claimThreshold, overview])

  const hasTemplateChanges = useMemo(() => {
    if (!overview) return false
    return (
      approvedTemplates !== overview.acceptance_templates.approved.join('\n') ||
      reworkTemplates !== overview.acceptance_templates.rework.join('\n') ||
      rejectedTemplates !== overview.acceptance_templates.rejected.join('\n')
    )
  }, [approvedTemplates, overview, rejectedTemplates, reworkTemplates])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await requestJson<SystemConfigOverview>('/system/config/overview', { userId })
      setOverview(data)
      setFeishuFreq(String(data.feishu_sync_frequency_minutes))
      setReleaseFreq(String(data.release_overdue_frequency_minutes))
      setClaimThreshold(String(data.claim_approval_overdue_threshold))
      setBudgetThreshold(String(data.budget_review_threshold))
      setApprovedTemplates(data.acceptance_templates.approved.join('\n'))
      setReworkTemplates(data.acceptance_templates.rework.join('\n'))
      setRejectedTemplates(data.acceptance_templates.rejected.join('\n'))
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载系统配置失败')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  const saveSyncConfig = async () => {
    const feishuValue = Number(feishuFreq)
    const releaseValue = Number(releaseFreq)

    if (!Number.isInteger(feishuValue) || feishuValue < 5) {
      setError('飞书同步频率必须是大于等于 5 的整数')
      return
    }
    if (!Number.isInteger(releaseValue) || releaseValue < 5) {
      setError('超期释放频率必须是大于等于 5 的整数')
      return
    }

    try {
      setSavingSync(true)
      setError(null)
      await Promise.all([
        requestJson<SyncFrequencyConfig>('/system/config/feishu-sync-frequency', {
          method: 'PUT',
          userId,
          body: { frequency_minutes: feishuValue },
        }),
        requestJson<SyncFrequencyConfig>('/system/config/release-overdue-frequency', {
          method: 'PUT',
          userId,
          body: { frequency_minutes: releaseValue },
        }),
      ])
      setMessage('同步相关配置已更新')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存同步配置失败')
    } finally {
      setSavingSync(false)
    }
  }

  const saveThresholdConfig = async () => {
    const claimThresholdValue = Number(claimThreshold)
    const budgetThresholdValue = Number(budgetThreshold)

    if (!Number.isInteger(claimThresholdValue) || claimThresholdValue < 1) {
      setError('揭榜审批阈值必须是大于等于 1 的整数')
      return
    }
    if (!Number.isFinite(budgetThresholdValue) || budgetThresholdValue < 0) {
      setError('资金复核阈值必须是大于等于 0 的数字')
      return
    }

    try {
      setSavingThreshold(true)
      setError(null)
      await Promise.all([
        requestJson<ClaimApprovalThresholdConfig>('/system/config/claim-approval-overdue-threshold', {
          method: 'PUT',
          userId,
          body: { threshold: claimThresholdValue },
        }),
        requestJson<BudgetReviewThresholdConfig>('/system/config/budget-review-threshold', {
          method: 'PUT',
          userId,
          body: { threshold: budgetThresholdValue },
        }),
      ])
      setMessage('审批阈值已更新')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存审批阈值失败')
    } finally {
      setSavingThreshold(false)
    }
  }

  const saveTemplates = async () => {
    const templatesPayload: AcceptanceTemplatesConfig = {
      approved: parseTemplateLines(approvedTemplates),
      rework: parseTemplateLines(reworkTemplates),
      rejected: parseTemplateLines(rejectedTemplates),
    }

    if (
      templatesPayload.approved.length === 0 ||
      templatesPayload.rework.length === 0 ||
      templatesPayload.rejected.length === 0
    ) {
      setError('每种验收结果至少需要一条模板')
      return
    }

    try {
      setSavingTemplates(true)
      setError(null)
      await requestJson<AcceptanceTemplatesConfig>('/system/config/acceptance-templates', {
        method: 'PUT',
        userId,
        body: templatesPayload,
      })
      setMessage('验收模板已更新')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存验收模板失败')
    } finally {
      setSavingTemplates(false)
    }
  }

  const runReleaseOverdueNow = async () => {
    try {
      setReleasing(true)
      setError(null)
      const result = await requestJson<{ released_claims: number; rule: string }>('/jobs/release-overdue', {
        method: 'POST',
        userId,
      })
      setMessage(`已执行超期释放，本次处理 ${result.released_claims} 条揭榜`)
      setConfirmReleaseOpen(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '执行超期释放失败')
    } finally {
      setReleasing(false)
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
        <h2>系统配置</h2>
        <p>集中管理同步频率、审批阈值和验收模板。</p>
      </header>

      <article className="panel">
        <div className="button-row">
          <button type="button" className={activeSection === 'sync' ? 'primary-btn' : ''} onClick={() => setActiveSection('sync')}>
            同步频率
          </button>
          <button type="button" className={activeSection === 'threshold' ? 'primary-btn' : ''} onClick={() => setActiveSection('threshold')}>
            审批阈值
          </button>
          <button type="button" className={activeSection === 'templates' ? 'primary-btn' : ''} onClick={() => setActiveSection('templates')}>
            验收模板
          </button>
          <button type="button" className={activeSection === 'ops' ? 'primary-btn' : ''} onClick={() => setActiveSection('ops')}>
            维护操作
          </button>
          <button type="button" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
        </div>
      </article>

      {activeSection === 'sync' && (
        <article className="panel form-grid">
          <h3 className="wide">同步频率配置</h3>
          <label>
            飞书同步频率（分钟）
            <input type="number" min={5} value={feishuFreq} onChange={(e) => setFeishuFreq(e.target.value)} disabled={loading} />
          </label>
          <label>
            超期释放频率（分钟）
            <input type="number" min={5} value={releaseFreq} onChange={(e) => setReleaseFreq(e.target.value)} disabled={loading} />
          </label>
          <div className="button-row wide">
            <button className="primary-btn" type="button" onClick={() => void saveSyncConfig()} disabled={savingSync || !hasSyncChanges}>
              {savingSync ? '保存中...' : '保存同步配置'}
            </button>
          </div>
        </article>
      )}

      {activeSection === 'threshold' && (
        <article className="panel form-grid">
          <h3 className="wide">审批阈值配置</h3>
          <label>
            揭榜审批阈值
            <input type="number" min={1} value={claimThreshold} onChange={(e) => setClaimThreshold(e.target.value)} disabled={loading} />
          </label>
          <label>
            资金复核阈值
            <input type="number" min={0} value={budgetThreshold} onChange={(e) => setBudgetThreshold(e.target.value)} disabled={loading} />
          </label>
          <div className="button-row wide">
            <button
              className="primary-btn"
              type="button"
              onClick={() => void saveThresholdConfig()}
              disabled={savingThreshold || !hasThresholdChanges}
            >
              {savingThreshold ? '保存中...' : '保存审批阈值'}
            </button>
          </div>
        </article>
      )}

      {activeSection === 'templates' && (
        <article className="panel form-grid">
          <h3 className="wide">验收模板配置</h3>
          <label className="wide">
            验收模板：通过（每行一条）
            <textarea value={approvedTemplates} onChange={(e) => setApprovedTemplates(e.target.value)} disabled={loading} />
          </label>
          <label className="wide">
            验收模板：整改（每行一条）
            <textarea value={reworkTemplates} onChange={(e) => setReworkTemplates(e.target.value)} disabled={loading} />
          </label>
          <label className="wide">
            验收模板：不通过（每行一条）
            <textarea value={rejectedTemplates} onChange={(e) => setRejectedTemplates(e.target.value)} disabled={loading} />
          </label>
          <div className="button-row wide">
            <button className="primary-btn" type="button" onClick={() => void saveTemplates()} disabled={savingTemplates || !hasTemplateChanges}>
              {savingTemplates ? '保存中...' : '保存模板'}
            </button>
          </div>
        </article>
      )}

      {activeSection === 'ops' && (
        <article className="panel">
          <h3>维护操作</h3>
          <p className="muted">立即触发一次超期揭榜释放任务，用于人工干预处理。</p>
          <div className="button-row">
            <button type="button" onClick={() => setConfirmReleaseOpen(true)}>
              立即释放超期揭榜
            </button>
          </div>
        </article>
      )}

      {overview && (
        <article className="panel">
          <h3>当前配置快照</h3>
          <p className="line-metric"><span>飞书同步频率</span><strong>{overview.feishu_sync_frequency_minutes} 分钟</strong></p>
          <p className="line-metric"><span>超期释放频率</span><strong>{overview.release_overdue_frequency_minutes} 分钟</strong></p>
          <p className="line-metric"><span>揭榜审批阈值</span><strong>{overview.claim_approval_overdue_threshold}</strong></p>
          <p className="line-metric"><span>资金复核阈值</span><strong>{overview.budget_review_threshold}</strong></p>
        </article>
      )}

      {confirmReleaseOpen && (
        <div className="modal-backdrop" onClick={() => setConfirmReleaseOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="release-overdue-title">
            <div className="panel-headline">
              <h3 id="release-overdue-title">确认执行超期释放</h3>
              <button type="button" onClick={() => setConfirmReleaseOpen(false)} disabled={releasing}>
                关闭
              </button>
            </div>
            <p>该操作会立即触发释放任务，可能改变正在进行中的揭榜状态。</p>
            <div className="button-row">
              <button type="button" onClick={() => setConfirmReleaseOpen(false)} disabled={releasing}>
                取消
              </button>
              <button className="primary-btn" type="button" onClick={() => void runReleaseOverdueNow()} disabled={releasing}>
                {releasing ? '执行中...' : '确认执行'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
