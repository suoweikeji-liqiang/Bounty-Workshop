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
      setError(err instanceof Error ? err.message : 'failed to load system config')
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
      setError('feishu sync frequency must be an integer >= 5')
      return
    }
    if (!Number.isInteger(releaseValue) || releaseValue < 5) {
      setError('release overdue frequency must be an integer >= 5')
      return
    }
    if (!Number.isInteger(thresholdValue) || thresholdValue < 1) {
      setError('claim threshold must be an integer >= 1')
      return
    }
    if (
      templatesPayload.approved.length === 0 ||
      templatesPayload.rework.length === 0 ||
      templatesPayload.rejected.length === 0
    ) {
      setError('acceptance templates require at least one line for each status')
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
      setMessage('system config updated')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save config')
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
        <h2>System Config</h2>
        <p>Centralized admin settings for frequency, claim policy, and acceptance templates.</p>
      </header>

      <article className="panel form-grid">
        <h3>Config Center</h3>
        <label>
          Feishu sync frequency (minutes)
          <input
            type="number"
            min={5}
            value={feishuFreq}
            onChange={(event) => setFeishuFreq(event.target.value)}
            disabled={loading}
          />
        </label>
        <label>
          Release overdue frequency (minutes)
          <input
            type="number"
            min={5}
            value={releaseFreq}
            onChange={(event) => setReleaseFreq(event.target.value)}
            disabled={loading}
          />
        </label>
        <label>
          Claim approval overdue threshold
          <input
            type="number"
            min={1}
            value={claimThreshold}
            onChange={(event) => setClaimThreshold(event.target.value)}
            disabled={loading}
          />
        </label>
        <label className="wide">
          Acceptance templates: approved (one line each)
          <textarea
            value={approvedTemplates}
            onChange={(event) => setApprovedTemplates(event.target.value)}
            disabled={loading}
          />
        </label>
        <label className="wide">
          Acceptance templates: rework (one line each)
          <textarea
            value={reworkTemplates}
            onChange={(event) => setReworkTemplates(event.target.value)}
            disabled={loading}
          />
        </label>
        <label className="wide">
          Acceptance templates: rejected (one line each)
          <textarea
            value={rejectedTemplates}
            onChange={(event) => setRejectedTemplates(event.target.value)}
            disabled={loading}
          />
        </label>
        <div className="button-row wide">
          <button type="button" onClick={() => void load()} disabled={loading}>
            refresh
          </button>
          <button className="primary-btn" type="button" onClick={() => void saveAll()} disabled={saving}>
            {saving ? 'saving...' : 'save all'}
          </button>
        </div>
      </article>

      {overview && (
        <article className="panel">
          <h3>Current Snapshot</h3>
          <p className="line-metric">
            <span>Feishu sync frequency</span>
            <strong>{overview.feishu_sync_frequency_minutes} min</strong>
          </p>
          <p className="line-metric">
            <span>Release overdue frequency</span>
            <strong>{overview.release_overdue_frequency_minutes} min</strong>
          </p>
          <p className="line-metric">
            <span>Claim approval threshold</span>
            <strong>{overview.claim_approval_overdue_threshold}</strong>
          </p>
        </article>
      )}
    </section>
  )
}
