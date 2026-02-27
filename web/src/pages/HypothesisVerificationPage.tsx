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

export function HypothesisVerificationPage({ userId }: Props) {
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [problems, setProblems] = useState<Problem[]>([])
  const [problemId, setProblemId] = useState('')
  const [analysis, setAnalysis] = useState<ProblemAnalysisReport | null>(null)
  const [hypotheses, setHypotheses] = useState<HypothesisVerification[]>([])
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

  const loadProblemOptions = useCallback(async () => {
    try {
      setLoadingProblems(true)
      setError(null)
      const [pending, repricing] = await Promise.all([
        requestJson<Problem[]>('/problems?status=pending_review&limit=200', { userId }),
        requestJson<Problem[]>('/problems?status=pricing_revision_required&limit=200', { userId }),
      ])
      const rows = [...pending, ...repricing]
      setProblems(rows)
      const queryProblemId = searchParams.get('problemId')
      setProblemId((prev) => {
        if (prev && rows.some((item) => String(item.id) === prev)) {
          return prev
        }
        if (queryProblemId && rows.some((item) => String(item.id) === queryProblemId)) {
          return queryProblemId
        }
        return rows.length > 0 ? String(rows[0].id) : ''
      })
      if (rows.length === 0) {
        setAnalysis(null)
        setHypotheses([])
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
      const [analysisData, hypothesesData] = await Promise.all([
        requestJson<ProblemAnalysisReport>(`/problems/${id}/analysis`, { userId }),
        requestJson<HypothesisVerification[]>(`/problems/${id}/hypotheses`, { userId }),
      ])
      setAnalysis(analysisData)
      setHypotheses(hypothesesData)
    } catch (err) {
      setAnalysis(null)
      setHypotheses([])
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [parseProblemId, userId])

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
    if (savingVerification) {
      return
    }
    setVerificationDraft(null)
    setVerificationMethod('')
    setVerificationResult('')
  }

  const submitVerification = async () => {
    if (!verificationDraft) {
      return
    }
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
    if (!queryProblemId) {
      return
    }
    if (queryProblemId !== problemId) {
      setProblemId(queryProblemId)
      setAnalysis(null)
      setHypotheses([])
    }
  }, [problemId, searchParams])

  useEffect(() => {
    if (!problemId) {
      return
    }
    void loadAnalysis()
  }, [problemId, loadAnalysis])

  useEffect(() => {
    if (!problemId) {
      return
    }
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
        <p>本页面由审核人/管理员操作：对 ProdMind 假设做验证记录。提交人请在「问题提报」页查看论证详情。</p>
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
            }}
            required
          >
            {problems.length === 0 && <option value="">暂无可选问题</option>}
            {problems.map((item) => (
              <option key={item.id} value={item.id}>
                #{item.id} [{item.status}] {item.title}
              </option>
            ))}
          </select>
        </label>
        {selectedProblem && (
          <p className="wide muted">
            当前问题：#{selectedProblem.id} / 场景 {selectedProblem.scenario} / 论证状态{' '}
            {selectedProblem.analysis_status ?? 'pending'}
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

      {analysis && (
        <>
          <article className="panel">
            <h3>论证结论</h3>
            <div className="line-metric">
              <span>立项建议</span>
              <strong
                style={{
                  color:
                    analysis.report.grounder.recommendation === '强烈推荐'
                      ? '#22c55e'
                      : analysis.report.grounder.recommendation === '推荐'
                        ? '#84cc16'
                        : analysis.report.grounder.recommendation === '中立'
                          ? '#f59e0b'
                          : '#dc2626',
                }}
              >
                {analysis.report.grounder.recommendation || '未知'}
              </strong>
            </div>
            <div className="line-metric">
              <span>置信度</span>
              <strong>{(analysis.report.grounder.confidence ?? 0) * 100}%</strong>
            </div>
            <div className="line-metric">
              <span>状态</span>
              <strong>{analysis.status}</strong>
            </div>
          </article>

          <article className="panel">
            <h3>问题重构（Architect）</h3>
            <div className="analysis-section">
              <p>
                <strong>核心问题：</strong>
                {analysis.report.architect.core_problem || '-'}
              </p>
              <p>
                <strong>目标用户：</strong>
                {analysis.report.architect.target_users?.join(', ') || '-'}
              </p>
              <p>
                <strong>问题边界：</strong>
                {analysis.report.architect.problem_boundaries || '-'}
              </p>
              <p>
                <strong>成功标准：</strong>
                {analysis.report.architect.success_criteria || '-'}
              </p>
            </div>
          </article>

          <article className="panel">
            <h3>假设挑战（Assassin）</h3>
            <div className="analysis-section">
              {analysis.report.assassin.assumptions_challenged?.length > 0 ? (
                analysis.report.assassin.assumptions_challenged.map(
                  (item: { assumption: string; challenge: string }, idx: number) => (
                    <div key={idx} className="analysis-item">
                      <p>
                        <strong>假设：</strong>
                        {item.assumption}
                      </p>
                      <p>
                        <strong>挑战：</strong>
                        {item.challenge}
                      </p>
                    </div>
                  ),
                )
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
                    {hyp.risk_level}
                  </span>
                  <span className="type-badge">{hyp.hypothesis_type}</span>
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
                    <p>
                      <strong>验证方法：</strong>
                      {hyp.verification_method || '-'}
                    </p>
                    <p>
                      <strong>验证结果：</strong>
                      {hyp.verification_result || '-'}
                    </p>
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
