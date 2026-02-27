import type { ProblemAnalysisReport } from '../types'

type Props = {
  analysis: ProblemAnalysisReport
}

export function AnalysisReportView({ analysis }: Props) {
  const confidencePercent =
    analysis.confidence != null
      ? `${Math.round(analysis.confidence * 100)}%`
      : analysis.report.grounder.confidence != null
        ? `${Math.round(analysis.report.grounder.confidence * 100)}%`
        : '-'

  return (
    <div className="analysis-report-view">
      <p className="line-metric">
        <span>状态</span>
        <strong>{analysis.status}</strong>
      </p>
      <p className="line-metric">
        <span>建议</span>
        <strong>{analysis.recommendation ?? analysis.report.grounder.recommendation ?? '-'}</strong>
      </p>
      <p className="line-metric">
        <span>置信度</span>
        <strong>{confidencePercent}</strong>
      </p>
      <p className="line-metric">
        <span>轮次</span>
        <strong>{analysis.rounds}</strong>
      </p>
      {analysis.error_message && (
        <p className="line-metric">
          <span>错误信息</span>
          <strong>{analysis.error_message}</strong>
        </p>
      )}

      <article className="modal-section">
        <h4>Architect - 问题重构</h4>
        <p><strong>核心问题：</strong>{analysis.report.architect.core_problem || '-'}</p>
        <p><strong>目标用户：</strong>{analysis.report.architect.target_users?.join(', ') || '-'}</p>
        <p><strong>问题边界：</strong>{analysis.report.architect.problem_boundaries || '-'}</p>
        <p><strong>成功标准：</strong>{analysis.report.architect.success_criteria || '-'}</p>
      </article>

      <article className="modal-section">
        <h4>Assassin - 假设挑战</h4>
        {(analysis.report.assassin.assumptions_challenged ?? []).length > 0 ? (
          <ul>
            {analysis.report.assassin.assumptions_challenged.map((item, idx) => (
              <li key={`assumption-${idx}`}>
                <strong>假设：</strong>{item.assumption}；<strong>挑战：</strong>{item.challenge}
              </li>
            ))}
          </ul>
        ) : (
          <p>-</p>
        )}
        {(analysis.report.assassin.risks_identified ?? []).length > 0 && (
          <>
            <p><strong>风险列表：</strong></p>
            <ul>
              {analysis.report.assassin.risks_identified.map((item, idx) => (
                <li key={`risk-${idx}`}>
                  <strong>[{item.severity}]</strong> {item.risk}；<strong>缓解建议：</strong>{item.mitigation}
                </li>
              ))}
            </ul>
          </>
        )}
      </article>

      <article className="modal-section">
        <h4>User Ghost - 用户视角</h4>
        <p><strong>关键追问：</strong>{analysis.report.user_ghost.user_questions?.join('；') || '-'}</p>
        <p><strong>价值优先级：</strong>{analysis.report.user_ghost.user_value_priorities?.join('；') || '-'}</p>
        <p><strong>边界场景：</strong>{analysis.report.user_ghost.edge_cases?.join('；') || '-'}</p>
      </article>

      <article className="modal-section">
        <h4>Grounder - 落地建议</h4>
        <p><strong>MVP 边界：</strong>{analysis.report.grounder.mvp_boundaries || '-'}</p>
        <p><strong>证伪检查：</strong>{analysis.report.grounder.falsification_checks?.join('；') || '-'}</p>
        <p><strong>下一步行动：</strong>{analysis.report.grounder.next_actions?.join('；') || '-'}</p>
      </article>
    </div>
  )
}

