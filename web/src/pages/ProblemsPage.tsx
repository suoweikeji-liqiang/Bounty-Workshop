import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { AnalysisReportView } from '../components/AnalysisReportView'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/ToastProvider'
import { getProblemDetail, listProblemAttachments, listProblems, type ProblemListFilters } from '../lib/api'
import { downloadFile, requestJson } from '../lib/http'
import {
  formatImpactScopeLabel,
  formatProblemFrequencyLabel,
  formatProblemStatusLabel,
  formatScenarioLabel,
} from '../lib/enumLabels'
import type { Attachment, HypothesisVerification, Problem, ProblemAnalysisReport, ProblemDetail } from '../types'

type Props = {
  userId: number
}

type ProblemFilters = ProblemListFilters

const defaultFilters: ProblemFilters = {
  mine_only: false,
  status: '',
  scenario: '',
  created_from: '',
  created_to: '',
}

const problemStatusOptions: Array<{ value: string; label: string }> = [
  { value: '', label: '全部' },
  { value: 'draft', label: '草稿' },
  { value: 'pending_review', label: '待评审' },
  { value: 'pricing_revision_required', label: '待重新定价' },
  { value: 'budget_pending', label: '待资金复核' },
  { value: 'approved', label: '已立项' },
  { value: 'rejected', label: '不立项' },
  { value: 'archived', label: '已归档' },
]

const scenarioOptions: Array<{ value: string; label: string }> = [
  { value: '', label: '全部' },
  { value: 'rd', label: '研发' },
  { value: 'ops', label: '运维' },
  { value: 'delivery', label: '交付' },
  { value: 'support', label: '支持' },
  { value: 'other', label: '其他' },
]

function parseFilters(searchParams: URLSearchParams): ProblemFilters {
  return {
    mine_only: searchParams.get('mine_only') === 'true',
    status: searchParams.get('status') ?? '',
    scenario: searchParams.get('scenario') ?? '',
    created_from: searchParams.get('created_from') ?? '',
    created_to: searchParams.get('created_to') ?? '',
  }
}

function toSearchParams(filters: ProblemFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.mine_only) params.set('mine_only', 'true')
  if (filters.status) params.set('status', filters.status)
  if (filters.scenario) params.set('scenario', filters.scenario)
  if (filters.created_from) params.set('created_from', filters.created_from)
  if (filters.created_to) params.set('created_to', filters.created_to)
  return params
}

function formatAnalysisStatus(status?: string) {
  if (!status) return '-'
  if (status === 'pending') return '待触发'
  if (status === 'analyzing') return '论证中'
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  return status
}

function analysisTone(status?: string): 'success' | 'warn' | 'danger' | 'info' | 'muted' {
  if (!status || status === 'pending') return 'muted'
  if (status === 'analyzing') return 'info'
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'danger'
  return 'muted'
}

function formatHypothesisVerificationStatus(status?: string) {
  if (!status) return '-'
  if (status === 'pending') return '待验证'
  if (status === 'verified') return '已验证'
  if (status === 'rejected') return '已否定'
  return status
}

function problemStatusTone(status: string): 'success' | 'warn' | 'danger' | 'info' | 'muted' {
  if (status === 'approved' || status === 'archived') return 'success'
  if (status === 'pending_review' || status === 'budget_pending' || status === 'pricing_revision_required') return 'warn'
  if (status === 'rejected') return 'danger'
  if (status === 'draft') return 'info'
  return 'muted'
}

export function ProblemsPage({ userId }: Props) {
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [filtersDraft, setFiltersDraft] = useState<ProblemFilters>(() => parseFilters(searchParams))
  const [filters, setFilters] = useState<ProblemFilters>(() => parseFilters(searchParams))
  const [list, setList] = useState<Problem[]>([])
  const [detailProblemId, setDetailProblemId] = useState<number | null>(null)
  const [detailData, setDetailData] = useState<ProblemDetail | null>(null)
  const [detailAttachments, setDetailAttachments] = useState<Attachment[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [analysisProblemId, setAnalysisProblemId] = useState<number | null>(null)
  const [analysisDetail, setAnalysisDetail] = useState<ProblemAnalysisReport | null>(null)
  const [analysisHypotheses, setAnalysisHypotheses] = useState<HypothesisVerification[]>([])
  const [analysisDetailLoading, setAnalysisDetailLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSearchParams(toSearchParams(filters), { replace: true })
  }, [filters, setSearchParams])

  const loadProblems = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await listProblems(userId, filters)
      setList(rows)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [filters, userId])

  useEffect(() => {
    void loadProblems()
  }, [loadProblems])

  const submitForReview = async (problemId: number) => {
    try {
      setError(null)
      await requestJson(`/problems/${problemId}/submit-for-review`, {
        method: 'POST',
        userId,
      })
      setMessage(`问题 #${problemId} 已提交评审，ProdMind 已自动开始论证`)
      await loadProblems()
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交评审失败')
    }
  }

  const triggerAnalysisNow = async (problemId: number) => {
    try {
      setError(null)
      await requestJson(`/problems/${problemId}/analyze`, {
        method: 'POST',
        userId,
      })
      setMessage(`问题 #${problemId} 已触发 ProdMind 论证`)
      await loadProblems()
    } catch (err) {
      setError(err instanceof Error ? err.message : '触发论证失败')
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

  useEffect(() => {
    if (analysisProblemId === null && detailProblemId === null) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAnalysisProblemId(null)
        setAnalysisDetail(null)
        setAnalysisHypotheses([])
        setDetailProblemId(null)
        setDetailData(null)
        setDetailAttachments([])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [analysisProblemId, detailProblemId])

  const openProblemDetail = async (problemId: number) => {
    setDetailProblemId(problemId)
    setDetailLoading(true)
    try {
      setError(null)
      const [detail, attachments] = await Promise.all([
        getProblemDetail(userId, problemId),
        listProblemAttachments(userId, problemId),
      ])
      setDetailData(detail)
      setDetailAttachments(attachments)
    } catch (err) {
      setDetailData(null)
      setDetailAttachments([])
      setError(err instanceof Error ? err.message : '加载问题详情失败')
    } finally {
      setDetailLoading(false)
    }
  }

  const openAnalysisDetail = async (problemId: number) => {
    setAnalysisProblemId(problemId)
    setAnalysisDetailLoading(true)
    try {
      setError(null)
      const [detail, hypotheses] = await Promise.all([
        requestJson<ProblemAnalysisReport>(`/problems/${problemId}/analysis`, { userId }),
        requestJson<HypothesisVerification[]>(`/problems/${problemId}/hypotheses`, { userId }).catch(() => []),
      ])
      setAnalysisDetail(detail)
      setAnalysisHypotheses(hypotheses)
    } catch (err) {
      setAnalysisDetail(null)
      setAnalysisHypotheses([])
      setError(err instanceof Error ? err.message : '加载论证详情失败')
    } finally {
      setAnalysisDetailLoading(false)
    }
  }

  const canEditStatus = useMemo(
    () => new Set(['draft', 'rejected']),
    [],
  )

  const hasPendingFilterChanges = useMemo(
    () =>
      filtersDraft.mine_only !== filters.mine_only ||
      filtersDraft.status !== filters.status ||
      filtersDraft.scenario !== filters.scenario ||
      filtersDraft.created_from !== filters.created_from ||
      filtersDraft.created_to !== filters.created_to,
    [filters, filtersDraft],
  )

  const encodedBack = encodeURIComponent(`${location.pathname}${location.search}`)

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>问题提报</h2>
        <p>先筛选再浏览列表；新建与编辑草稿已迁移到独立页面。</p>
      </header>

      <form
        className="panel filter-panel"
        onSubmit={(event) => {
          event.preventDefault()
          if (hasPendingFilterChanges) {
            setFilters(filtersDraft)
            return
          }
          void loadProblems()
        }}
      >
        <div className="panel-headline">
          <h3>问题筛选</h3>
        </div>
        <div className="filter-toolbar">
          <label className="filter-field">
            <span>范围</span>
            <select
              value={filtersDraft.mine_only ? 'mine' : 'all'}
              onChange={(e) => setFiltersDraft((prev) => ({ ...prev, mine_only: e.target.value === 'mine' }))}
            >
              <option value="all">全部</option>
              <option value="mine">仅我提报</option>
            </select>
          </label>
          <label className="filter-field">
            <span>状态</span>
            <select value={filtersDraft.status} onChange={(e) => setFiltersDraft((p) => ({ ...p, status: e.target.value }))}>
              {problemStatusOptions.map((item) => (
                <option key={`problem-status-${item.value || 'all'}`} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>场景</span>
            <select value={filtersDraft.scenario} onChange={(e) => setFiltersDraft((p) => ({ ...p, scenario: e.target.value }))}>
              {scenarioOptions.map((item) => (
                <option key={`scenario-${item.value || 'all'}`} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>起始日期</span>
            <input type="date" value={filtersDraft.created_from} onChange={(e) => setFiltersDraft((p) => ({ ...p, created_from: e.target.value }))} />
          </label>
          <label className="filter-field">
            <span>截止日期</span>
            <input type="date" value={filtersDraft.created_to} onChange={(e) => setFiltersDraft((p) => ({ ...p, created_to: e.target.value }))} />
          </label>
          <div className="filter-actions">
            <button className="primary-btn" type="submit" disabled={loading}>应用筛选</button>
            <button
              type="button"
              onClick={() => {
                setFiltersDraft(defaultFilters)
                setFilters(defaultFilters)
              }}
              disabled={loading}
            >
              重置
            </button>
            <button type="button" onClick={() => void loadProblems()} disabled={loading}>
              刷新
            </button>
          </div>
        </div>
      </form>

      <article className="panel">
        <div className="panel-headline">
          <h3>问题列表</h3>
          <span className="actions">
            <button type="button" onClick={() => navigate(`/problems/new?back=${encodedBack}`)}>新建草稿</button>
          </span>
        </div>
        <div className="table">
          <div className="row head wide-row problems-row">
            <span>ID</span>
            <span>标题</span>
            <span>提交人</span>
            <span>场景</span>
            <span>状态</span>
            <span>论证状态</span>
            <span>评审意见</span>
            <span>时间</span>
            <span>操作</span>
          </div>
          {loading && (
            <div className="row wide-row problems-row">
              <span style={{ gridColumn: '1 / -1', textAlign: 'center' }}>加载中...</span>
            </div>
          )}
          {!loading && list.length === 0 && (
            <div className="row wide-row problems-row">
              <span style={{ gridColumn: '1 / -1', textAlign: 'center' }}>暂无符合条件的问题</span>
            </div>
          )}
          {!loading && list.map((item) => {
            const canEdit = item.submitter_id === userId && canEditStatus.has(item.status)
            const canSubmitReview = item.submitter_id === userId && item.status === 'draft'
            const canOpenAnalysis = item.analysis_status === 'completed' || item.analysis_status === 'failed'
            const canTriggerAnalysis =
              item.submitter_id === userId &&
              item.status !== 'archived' &&
              item.status !== 'rejected' &&
              item.analysis_status !== 'analyzing'
            return (
              <div className="row wide-row problems-row" key={item.id}>
                <span>#{item.id}</span>
                <span title={item.title}>{item.title}</span>
                <span title={item.submitter_name}>{item.submitter_name || `#${item.submitter_id}`}</span>
                <span>{formatScenarioLabel(item.scenario)}</span>
                <span>
                  <StatusBadge tone={problemStatusTone(item.status)}>{formatProblemStatusLabel(item.status)}</StatusBadge>
                </span>
                <span>
                  <StatusBadge tone={analysisTone(item.analysis_status)}>
                    {formatAnalysisStatus(item.analysis_status)}
                  </StatusBadge>
                </span>
                <span>{item.reviewer_comment ?? item.reject_reason ?? '-'}</span>
                <span>{new Date(item.created_at).toLocaleDateString()}</span>
                <span className="actions problem-row-actions">
                  <button type="button" onClick={() => void openProblemDetail(item.id)}>详情</button>
                  {canEdit && (
                    <button type="button" onClick={() => navigate(`/problems/${item.id}/edit?back=${encodedBack}`)}>
                      编辑
                    </button>
                  )}
                  {canSubmitReview && <button type="button" onClick={() => void submitForReview(item.id)}>提交评审</button>}
                  {canOpenAnalysis && <button type="button" onClick={() => void openAnalysisDetail(item.id)}>论证详情</button>}
                  {canTriggerAnalysis && <button type="button" onClick={() => void triggerAnalysisNow(item.id)}>立即论证</button>}
                </span>
              </div>
            )
          })}
        </div>
      </article>

      {detailProblemId !== null && (
        <div className="modal-backdrop" onClick={() => { setDetailProblemId(null); setDetailData(null); setDetailAttachments([]) }}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="问题详情"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-headline">
              <h3>问题详情（#{detailProblemId}）</h3>
              <button type="button" onClick={() => { setDetailProblemId(null); setDetailData(null); setDetailAttachments([]) }}>
                关闭
              </button>
            </div>
            {detailLoading ? (
              <p>加载中...</p>
            ) : detailData ? (
              <>
                <details className="modal-fold" open>
                  <summary>基础信息</summary>
                  <section className="modal-section">
                    <p className="line-metric"><span>标题</span><strong>{detailData.title}</strong></p>
                    <p className="line-metric"><span>场景</span><strong>{formatScenarioLabel(detailData.scenario)}</strong></p>
                    <p className="line-metric"><span>频率</span><strong>{formatProblemFrequencyLabel(detailData.frequency)}</strong></p>
                    <p className="line-metric"><span>影响范围</span><strong>{formatImpactScopeLabel(detailData.impact_scope)}</strong></p>
                    <p className="line-metric"><span>状态</span><strong>{formatProblemStatusLabel(detailData.status)}</strong></p>
                    <p className="line-metric"><span>提交人</span><strong>{detailData.submitter_name}</strong></p>
                  </section>
                </details>
                <details className="modal-fold" open>
                  <summary>问题内容</summary>
                  <section className="modal-section">
                    <p><strong>背景：</strong>{detailData.background}</p>
                    <p><strong>问题描述：</strong>{detailData.description}</p>
                    <p><strong>价值说明：</strong>{detailData.value_statement}</p>
                    <p><strong>当前解决方式：</strong>{detailData.current_solution || '-'}</p>
                  </section>
                </details>
                <details className="modal-fold">
                  <summary>提交人任务定义</summary>
                  <section className="modal-section">
                    <p><strong>目标：</strong>{detailData.draft_goal || '-'}</p>
                    <p><strong>范围：</strong>{detailData.draft_scope || '-'}</p>
                    <p><strong>截止日期：</strong>{detailData.draft_due_date || '-'}</p>
                    <p><strong>自我复盘：</strong>{detailData.submitter_reflection || '-'}</p>
                    <p><strong>验收标准：</strong></p>
                    {(detailData.draft_acceptance_criteria ?? []).length > 0 ? (
                      <ul>
                        {(detailData.draft_acceptance_criteria ?? []).map((item, idx) => (
                          <li key={`criteria-${idx}`}>
                            {item.description || '-'}（{item.type === 'behavioral' ? '行为' : '量化'}）
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>-</p>
                    )}
                  </section>
                </details>
                <details className="modal-fold">
                  <summary>评审与定价</summary>
                  <section className="modal-section">
                    <p><strong>评审意见：</strong>{detailData.reviewer_comment || detailData.reject_reason || '-'}</p>
                    <p><strong>任务等级：</strong>{detailData.priced_level || '-'}</p>
                    <p><strong>奖励总额：</strong>{detailData.priced_reward_total ?? '-'}</p>
                    <p><strong>提交人分成比例：</strong>{detailData.priced_proposer_ratio ?? '-'}</p>
                    <p><strong>积分：</strong>{detailData.priced_points ?? '-'}</p>
                    <p><strong>徽章：</strong>{detailData.priced_badge || '-'}</p>
                  </section>
                </details>
                <details className="modal-fold">
                  <summary>附件（{detailAttachments.length}）</summary>
                  <section className="modal-section">
                    {detailAttachments.length > 0 ? (
                      <ul>
                        {detailAttachments.map((file) => (
                          <li key={file.id}>
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => void downloadFile(file.download_url, file.filename, { userId })}
                            >
                              {file.filename}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>无附件</p>
                    )}
                  </section>
                </details>
              </>
            ) : (
              <p>暂无问题详情</p>
            )}
          </div>
        </div>
      )}

      {analysisProblemId !== null && (
        <div className="modal-backdrop" onClick={() => { setAnalysisProblemId(null); setAnalysisDetail(null); setAnalysisHypotheses([]) }}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="论证详情"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-headline">
              <h3>ProdMind 论证详情（问题 #{analysisProblemId}）</h3>
              <button type="button" onClick={() => { setAnalysisProblemId(null); setAnalysisDetail(null); setAnalysisHypotheses([]) }}>
                关闭
              </button>
            </div>
            {analysisDetailLoading ? (
              <p>加载中...</p>
            ) : analysisDetail ? (
              <>
                <AnalysisReportView analysis={analysisDetail} />
                <article className="modal-section">
                  <h4>人工验证记录</h4>
                  {analysisHypotheses.length > 0 ? (
                    <ul>
                      {analysisHypotheses.map((item) => (
                        <li key={`analysis-hypothesis-${item.id}`}>
                          <p><strong>假设：</strong>{item.hypothesis_content || '-'}</p>
                          <p><strong>结论：</strong>{formatHypothesisVerificationStatus(item.verification_status)}</p>
                          <p><strong>验证方法：</strong>{item.verification_method || '-'}</p>
                          <p><strong>验证结果：</strong>{item.verification_result || '-'}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>-</p>
                  )}
                </article>
              </>
            ) : (
              <p>暂无论证详情</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
