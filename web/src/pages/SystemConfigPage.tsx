import { useCallback, useEffect, useState } from 'react'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type {
  AcceptanceTemplatesConfig,
  ClaimApprovalThresholdConfig,
  SyncFrequencyConfig,
  SystemConfigOverview,
} from '../types'

type Props = {
  userId: number
}

export function SystemConfigPage({ userId }: Props) {
  const toast = useToast()
  const [overview, setOverview] = useState<SystemConfigOverview | null>(null)
  const [feishuFreq, setFeishuFreq] = useState('')
  const [releaseFreq, setReleaseFreq] = useState('')
  const [claimThreshold, setClaimThreshold] = useState('')
  const [approvedTemplates, setApprovedTemplates] = useState('')
  const [reworkTemplates, setReworkTemplates] = useState('')
  const [rejectedTemplates, setRejectedTemplates] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await requestJson<SystemConfigOverview>('/system/config/overview', { userId })
      setOverview(data)
      setFeishuFreq(String(data.feishu_sync_frequency_minutes))
      setReleaseFreq(String(data.release_overdue_frequency_minutes))
      setClaimThreshold(String(data.claim_approval_overdue_threshold))
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

  const saveAll = async () => {
    const feishuValue = Number(feishuFreq)
    const releaseValue = Number(releaseFreq)
    const thresholdValue = Number(claimThreshold)
    const parseLines = (text: string) =>
      text
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)

    const templatesPayload: AcceptanceTemplatesConfig = {
      approved: parseLines(approvedTemplates),
      rework: parseLines(reworkTemplates),
      rejected: parseLines(rejectedTemplates),
    }

    if (!Number.isInteger(feishuValue) || feishuValue < 5) {
      setError('飞书同步频率必须是大于等于 5 的整数')
      return
    }
    if (!Number.isInteger(releaseValue) || releaseValue < 5) {
      setError('超期释放频率必须是大于等于 5 的整数')
      return
    }
    if (!Number.isInteger(thresholdValue) || thresholdValue < 1) {
      setError('揭榜阈值必须是大于等于 1 的整数')
      return
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
      setSaving(true)
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
        requestJson<ClaimApprovalThresholdConfig>(
          '/system/config/claim-approval-overdue-threshold',
          {
            method: 'PUT',
            userId,
            body: { threshold: thresholdValue },
          },
        ),
        requestJson<AcceptanceTemplatesConfig>('/system/config/acceptance-templates', {
          method: 'PUT',
          userId,
          body: templatesPayload,
        }),
      ])
      setMessage('系统配置已更新')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存配置失败')
    } finally {
      setSaving(false)
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
        <h2>系统配置</h2>
        <p>集中管理同步频率、揭榜策略和验收模板。</p>
      </header>

      <article className="panel form-grid">
        <h3>配置中心</h3>
        <label>
          飞书同步频率（分钟）
          <input
            type="number"
            min={5}
            value={feishuFreq}
            onChange={(event) => setFeishuFreq(event.target.value)}
            disabled={loading}
          />
        </label>
        <label>
          超期释放频率（分钟）
          <input
            type="number"
            min={5}
            value={releaseFreq}
            onChange={(event) => setReleaseFreq(event.target.value)}
            disabled={loading}
          />
        </label>
        <label>
          揭榜审批超期阈值
          <input
            type="number"
            min={1}
            value={claimThreshold}
            onChange={(event) => setClaimThreshold(event.target.value)}
            disabled={loading}
          />
        </label>
        <label className="wide">
          验收模板：通过（每行一条）
          <textarea
            value={approvedTemplates}
            onChange={(event) => setApprovedTemplates(event.target.value)}
            disabled={loading}
          />
        </label>
        <label className="wide">
          验收模板：返工（每行一条）
          <textarea
            value={reworkTemplates}
            onChange={(event) => setReworkTemplates(event.target.value)}
            disabled={loading}
          />
        </label>
        <label className="wide">
          验收模板：驳回（每行一条）
          <textarea
            value={rejectedTemplates}
            onChange={(event) => setRejectedTemplates(event.target.value)}
            disabled={loading}
          />
        </label>
        <div className="button-row wide">
          <button type="button" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
          <button className="primary-btn" type="button" onClick={() => void saveAll()} disabled={saving}>
            {saving ? '保存中...' : '保存全部'}
          </button>
        </div>
      </article>

      {overview && (
        <article className="panel">
          <h3>当前配置快照</h3>
          <p className="line-metric">
            <span>飞书同步频率</span>
            <strong>{overview.feishu_sync_frequency_minutes} 分钟</strong>
          </p>
          <p className="line-metric">
            <span>超期释放频率</span>
            <strong>{overview.release_overdue_frequency_minutes} 分钟</strong>
          </p>
          <p className="line-metric">
            <span>揭榜审批阈值</span>
            <strong>{overview.claim_approval_overdue_threshold}</strong>
          </p>
        </article>
      )}
    </section>
  )
}
