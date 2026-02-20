import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { HypothesisVerification, ProblemAnalysisReport } from '../types'

type Props = {
  userId: number
}

export function HypothesisVerificationPage({ userId }: Props) {
  const toast = useToast()
  const [problemId, setProblemId] = useState('')
  const [analysis, setAnalysis] = useState<ProblemAnalysisReport | null>(null)
  const [hypotheses, setHypotheses] = useState<HypothesisVerification[]>([])
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadAnalysis = useCallback(async () => {
    if (!problemId.trim()) return
    const id = Number(problemId.trim())
    if (!Number.isInteger(id) || id <= 0) {
      setError('请输入有效的问题 ID')
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
  }, [problemId, userId])

  const handleAnalyze = async () => {
    if (!problemId.trim()) return
    const id = Number(problemId.trim())
    if (!Number.isInteger(id) || id <= 0) {
      setError('请输入有效的问题 ID')
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
    result: string
  ) => {
    try {
      await requestJson(`/problems/${problemId}/hypotheses/${hypothesisId}`, {
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
        <h2>假设验证工作台</h2>
        <p>查看问题论证报告，验证 ProdMind 生成的假设清单。</p>
      </header>

      <form
        className="panel form-grid"
        onSubmit={(e) => {
          e.preventDefault()
          void loadAnalysis()
        }}
      >
        <label>
          问题 ID
          <input
            type="number"
            value={problemId}
            onChange={(e) => setProblemId(e.target.value)}
            placeholder="输入问题 ID"
            min={1}
          />
        </label>
        <div className="button-row">
          <button className="primary-btn" type="submit" disabled={loading || !problemId.trim()}>
            {loading ? '加载中...' : '加载报告'}
          </button>
          <button
            type="button"
            onClick={() => void handleAnalyze()}
            disabled={analyzing || !problemId.trim()}
          >
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
                analysis.report.assassin.assumptions_challenged.map((item: { assumption: string; challenge: string }, idx: number) => (
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
                ))
              ) : (
                <p style={{ color: '#888' }}>无</p>
              )}
            </div>
          </article>

          <article className="panel">
            <h3>假设清单（{hypotheses.length}）</h3>
            {hypotheses.map((hyp) => (
              <div key={hyp.id} className="hypothesis-card">
                <div className="hypothesis-header">
                  <span
                    className="risk-badge"
                    style={{ backgroundColor: getRiskColor(hyp.risk_level) }}
                  >
                    {hyp.risk_level}
                  </span>
                  <span className="type-badge">{hyp.hypothesis_type}</span>
                  {getStatusBadge(hyp.verification_status)}
                </div>
                <p className="hypothesis-content">{hyp.hypothesis_content}</p>
                {hyp.verification_status === 'pending' && (
                  <div className="hypothesis-actions">
                    <button
                      type="button"
                      onClick={() => {
                        const method = prompt('验证方法：')
                        if (method) {
                          const result = prompt('验证结果：') || ''
                          void updateHypothesis(hyp.id, 'verified', method, result)
                        }
                      }}
                    >
                      标记已验证
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const method = prompt('验证方法：')
                        if (method) {
                          const result = prompt('验证结果：') || ''
                          void updateHypothesis(hyp.id, 'rejected', method, result)
                        }
                      }}
                    >
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
        </>
      )}
    </section>
  )
}
