import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { HypothesisVerification, Problem, ProblemAnalysisReport } from '../types'

type Props = {
  userId: number
}

type VerificationDraft = {
  hypothesisId: number
  status: 'verified' | 'rejected'
}

function formatAnalysisStatus(status?: string) {
  if (!status) return '待触发'
  const map: Record<string, string> = {
    pending: '待触发',
    analyzing: '论证中',
    completed: '已完成',
    failed: '失败',
  }
  return map[status] ?? status
}

function formatProblemStatus(status?: string) {
  if (!status) return '-'
  const map: Record<string, string> = {
    draft: '草稿',
    pending_review: '待评审',
    pricing_revision_required: '待重新定价',
    budget_pending: '待资金复核',
    approved: '已立项',
    rejected: '不立项',
    archived: '已归档',
  }
  return map[status] ?? status
}

function formatScenario(scenario?: string) {
  if (!scenario) return '-'
  const map: Record<string, string> = {
    rd: '研发',
    ops: '运维',
    delivery: '交付',
    support: '支持',
    other: '其他',
  }
  return map[scenario] ?? scenario
}

function formatRecommendation(value?: string | null) {
  if (!value) return '未知'
  const map: Record<string, string> = {
    strong_recommend: '强烈推荐',
    recommend: '推荐',
    neutral: '中立',
    not_recommend: '不推荐',
  }
  return map[value] ?? value
}

function formatRiskLevel(level: string) {
  const map: Record<string, string> = {
    high: '高风险',
    medium: '中风险',
    low: '低风险',
  }
  return map[level] ?? level
}

function formatHypothesisType(type: string) {
  const map: Record<string, string> = {
    market: '市场',
    technical: '技术',
    requirement: '需求',
  }
  return map[type] ?? type
}

export function HypothesisVerificationPage({ userId }: Props) {
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const [problems, setProblems] = useState<Problem[]>([])
  const [problemId, setProblemId] = useState('')
  const [analysis, setAnalysis] = useState<ProblemAnalysisReport | null>(null)
  const [hypotheses, setHypotheses] = useState<HypothesisVerification[]>([])
  const [analysisHint, setAnalysisHint] = useState<string | null>(null)

  const [loading, setLoading] = useState(false)
  const [loadingProblems, setLoadingProblems] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [savingVerification, setSavingVerification] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [verificationDraft, setVerificationDraft] = useState<VerificationDraft | null>(null)
  const [verificationMethod, setVerificationMethod] = useState('')
  const [verificationResult, setVerificationResult] = useState('')

  const selectedProblem = useMemo(
    () => problems.find((item) => String(item.id) === problemId) ?? null,
    [problemId, problems],
  )

  const parseProblemId = useCallback(() => {
    const id = Number(problemId)
    return Number.isInteger(id) && id > 0 ? id : null
  }, [problemId])

  const isAnalysisNotFound = (err: unknown) =>
    err instanceof Error && err.message.includes('404') && err.message.includes('analysis not found')

  const loadProblemOptions = useCallback(async () => {
    try {
      setLoadingProblems(true)
      setError(null)
      const [pending, repricing] = await Promise.all([
        requestJson<Problem[]>('/problems?status=pending_review&limit=200', { userId }),
        requestJson<Problem[]>('/problems?status=pricing_revision_required&limit=200', { userId }),
      ])

      const merged = [...pending, ...repricing]
      const deduped = Array.from(new Map(merged.map((item) => [item.id, item])).values())
      setProblems(deduped)

      const queryProblemId = searchParams.get('problemId')
      setProblemId((prev) => {
        if (prev && deduped.some((item) => String(item.id) === prev)) {
          return prev
        }
        if (queryProblemId && deduped.some((item) => String(item.id) === queryProblemId)) {
          return queryProblemId
        }
        return deduped.length > 0 ? String(deduped[0].id) : ''
      })

      if (deduped.length === 0) {
        setAnalysis(null)
        setHypotheses([])
        setAnalysisHint(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载问题列表失败')
    } finally {
      setLoadingProblems(false)
    }
  }, [searchParams, userId])

  const loadAnalysis = useCallback(async () => {
    const id = parseProblemId()
    if (!id) {
      setError('请先选择问题')
      return
    }

    setLoading(true)
    try {
      setError(null)
      setAnalysisHint(null)

      const analysisData = await requestJson<ProblemAnalysisReport>(`/problems/${id}/analysis`, { userId })
      setAnalysis(analysisData)

      try {
        const hypothesesData = await requestJson<HypothesisVerification[]>(`/problems/${id}/hypotheses`, { userId })
        setHypotheses(hypothesesData)
      } catch (err) {
        if (isAnalysisNotFound(err)) {
          setHypotheses([])
        } else {
          throw err
        }
      }
    } catch (err) {
      if (isAnalysisNotFound(err)) {
        setAnalysis(null)
        setHypotheses([])
        const nextHint =
          selectedProblem?.analysis_status === 'analyzing'
            ? 'ProdMind 正在论证中，请稍后再点击“加载报告”。'
            : '当前还没有可用论证报告，可点击“重新论证”触发。'
        setAnalysisHint(nextHint)
      } else {
        setAnalysis(null)
        setHypotheses([])
        setError(err instanceof Error ? err.message : '加载报告失败')
      }
    } finally {
      setLoading(false)
    }
  }, [parseProblemId, selectedProblem?.analysis_status, userId])

  const handleAnalyze = async () => {
    const id = parseProblemId()
    if (!id) {
      setError('请先选择问题')
      return
    }

    setAnalyzing(true)
    try {
      setError(null)
      await requestJson(`/problems/${id}/analyze`, { method: 'POST', userId })
      toast.info('已触发 ProdMind 论证，请稍后加载报告')
      await loadProblemOptions()
      await loadAnalysis()
    } catch (err) {
      setError(err instanceof Error ? err.message : '触发论证失败')
    } finally {
      setAnalyzing(false)
    }
  }

  const updateHypothesis = async (
    hypothesisId: number,
    status: 'verified' | 'rejected',
    method: string,
    result: string,
  ) => {
    const id = parseProblemId()
    if (!id) {
      setError('请先选择问题')
      return
    }

    try {
      await requestJson(`/problems/${id}/hypotheses/${hypothesisId}`, {
        method: 'PUT',
        userId,
        body: {
          verification_status: status,
          verification_method: method,
          verification_result: result,
        },
      })
      toast.success('假设验证已更新')
      await loadAnalysis()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新失败')
    }
  }

  const openVerificationEditor = (hypothesisId: number, status: 'verified' | 'rejected') => {
    setVerificationDraft({ hypothesisId, status })
    setVerificationMethod('')
    setVerificationResult('')
  }

  const closeVerificationEditor = () => {
    if (savingVerification) return
    setVerificationDraft(null)
    setVerificationMethod('')
    setVerificationResult('')
  }

  const submitVerification = async () => {
    if (!verificationDraft) return

    const method = verificationMethod.trim()
    if (!method) {
      setError('请填写验证方法')
      return
    }

    try {
      setSavingVerification(true)
      await updateHypothesis(
        verificationDraft.hypothesisId,
        verificationDraft.status,
        method,
        verificationResult.trim(),
      )
      closeVerificationEditor()
    } finally {
      setSavingVerification(false)
    }
  }

  useEffect(() => {
    void loadProblemOptions()
  }, [loadProblemOptions])

  useEffect(() => {
    const queryProblemId = searchParams.get('problemId')
    if (!queryProblemId) return

    if (queryProblemId !== problemId) {
      setProblemId(queryProblemId)
      setAnalysis(null)
      setHypotheses([])
      setAnalysisHint(null)
    }
  }, [problemId, searchParams])

  useEffect(() => {
    if (!problemId) return
    void loadAnalysis()
  }, [problemId, loadAnalysis])

  useEffect(() => {
    if (!problemId) return
    if (searchParams.get('problemId') !== problemId) {
      setSearchParams({ problemId })
    }
  }, [problemId, searchParams, setSearchParams])

  useEffect(() => {
    if (error) toast.error(error)
  }, [error, toast])

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'high':
        return '#dc2626'
      case 'medium':
        return '#f59e0b'
      case 'low':
        return '#22c55e'
      default:
        return '#888'
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'verified':
        return <span style={{ color: '#22c55e', fontWeight: 'bold' }}>已验证</span>
      case 'rejected':
        return <span style={{ color: '#dc2626', fontWeight: 'bold' }}>已拒绝</span>
      default:
        return <span style={{ color: '#888' }}>待验证</span>
    }
  }

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>假设验证（审核）</h2>
        <p>本页面由审核人/管理员操作：记录对 ProdMind 假设的验证结果。提报人请在「问题提报」查看论证详情。</p>
      </header>

      <form
        className="panel form-grid"
        onSubmit={(event) => {
          event.preventDefault()
          void loadAnalysis()
        }}
      >
        <label>
          选择问题
          <select
            value={problemId}
            onChange={(event) => {
              const next = event.target.value
              setProblemId(next)
              if (next) {
                setSearchParams({ problemId: next })
              } else {
                setSearchParams({})
              }
              setAnalysis(null)
              setHypotheses([])
              setAnalysisHint(null)
            }}
            required
          >
            {problems.length === 0 && <option value="">暂无可选问题</option>}
            {problems.map((item) => (
              <option key={item.id} value={item.id}>
                #{item.id} [{formatProblemStatus(item.status)}] {item.title}
              </option>
            ))}
          </select>
        </label>

        {selectedProblem && (
          <p className="wide muted">
            当前问题：#{selectedProblem.id} / 场景 {formatScenario(selectedProblem.scenario)} / 论证状态 {formatAnalysisStatus(selectedProblem.analysis_status)}
          </p>
        )}

        <div className="button-row">
          <button type="button" onClick={() => void loadProblemOptions()} disabled={loadingProblems}>
            {loadingProblems ? '刷新中...' : '刷新问题'}
          </button>
          <button className="primary-btn" type="submit" disabled={loading || !problemId}>
            {loading ? '加载中...' : '加载报告'}
          </button>
          <button type="button" onClick={() => void handleAnalyze()} disabled={analyzing || !problemId}>
            {analyzing ? '论证中...' : '重新论证'}
          </button>
        </div>
      </form>

      {!analysis && analysisHint && (
        <article className="panel">
          <p className="wide muted">{analysisHint}</p>
        </article>
      )}

      {analysis && (
        <>
          <article className="panel">
            <h3>论证结论</h3>
            <div className="line-metric">
              <span>立项建议</span>
              <strong>{formatRecommendation(analysis.report.grounder.recommendation)}</strong>
            </div>
            <div className="line-metric">
              <span>置信度</span>
              <strong>{Math.round((analysis.report.grounder.confidence ?? 0) * 100)}%</strong>
            </div>
            <div className="line-metric">
              <span>状态</span>
              <strong>{formatAnalysisStatus(analysis.status)}</strong>
            </div>
            {analysis.status === 'failed' && (
              <p className="muted">失败原因：{analysis.error_message || '未返回错误详情'}</p>
            )}
          </article>

          <article className="panel">
            <h3>问题重构</h3>
            <div className="analysis-section">
              <p><strong>核心问题：</strong>{analysis.report.architect.core_problem || '-'}</p>
              <p><strong>目标用户：</strong>{analysis.report.architect.target_users?.join('、') || '-'}</p>
              <p><strong>问题边界：</strong>{analysis.report.architect.problem_boundaries || '-'}</p>
              <p><strong>成功标准：</strong>{analysis.report.architect.success_criteria || '-'}</p>
            </div>
          </article>

          <article className="panel">
            <h3>假设挑战</h3>
            <div className="analysis-section">
              {analysis.report.assassin.assumptions_challenged?.length > 0 ? (
                analysis.report.assassin.assumptions_challenged.map((item, idx) => (
                  <div key={idx} className="analysis-item">
                    <p><strong>假设：</strong>{item.assumption}</p>
                    <p><strong>挑战：</strong>{item.challenge}</p>
                  </div>
                ))
              ) : (
                <p style={{ color: '#888' }}>暂无</p>
              )}
            </div>
          </article>

          <article className="panel">
            <h3>假设清单（{hypotheses.length}）</h3>
            {hypotheses.map((hyp) => (
              <div key={hyp.id} className="hypothesis-card">
                <div className="hypothesis-header">
                  <span className="risk-badge" style={{ backgroundColor: getRiskColor(hyp.risk_level) }}>
                    {formatRiskLevel(hyp.risk_level)}
                  </span>
                  <span className="type-badge">{formatHypothesisType(hyp.hypothesis_type)}</span>
                  {getStatusBadge(hyp.verification_status)}
                </div>
                <p className="hypothesis-content">{hyp.hypothesis_content}</p>

                {hyp.verification_status === 'pending' && (
                  <div className="hypothesis-actions">
                    <button type="button" onClick={() => openVerificationEditor(hyp.id, 'verified')}>
                      标记已验证
                    </button>
                    <button type="button" onClick={() => openVerificationEditor(hyp.id, 'rejected')}>
                      标记已拒绝
                    </button>
                  </div>
                )}

                {hyp.verification_status !== 'pending' && (
                  <div className="verification-info">
                    <p><strong>验证方法：</strong>{hyp.verification_method || '-'}</p>
                    <p><strong>验证结果：</strong>{hyp.verification_result || '-'}</p>
                  </div>
                )}
              </div>
            ))}
            {hypotheses.length === 0 && <p style={{ color: '#888' }}>暂无假设</p>}
          </article>

          {verificationDraft && (
            <div className="modal-backdrop" onClick={closeVerificationEditor}>
              <div
                className="modal-card"
                role="dialog"
                aria-modal="true"
                aria-labelledby="verification-dialog-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="panel-headline">
                  <h3 id="verification-dialog-title">
                    {verificationDraft.status === 'verified' ? '标记已验证' : '标记已拒绝'}
                  </h3>
                  <button type="button" onClick={closeVerificationEditor} disabled={savingVerification}>
                    关闭
                  </button>
                </div>

                <label className="wide">
                  验证方法
                  <textarea
                    value={verificationMethod}
                    onChange={(event) => setVerificationMethod(event.target.value)}
                    placeholder="说明你如何验证该假设"
                    required
                  />
                </label>

                <label className="wide">
                  验证结果
                  <textarea
                    value={verificationResult}
                    onChange={(event) => setVerificationResult(event.target.value)}
                    placeholder="填写验证结果（可选）"
                  />
                </label>

                <div className="button-row">
                  <button className="primary-btn" type="button" onClick={() => void submitVerification()} disabled={savingVerification}>
                    {savingVerification ? '提交中...' : '提交'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}