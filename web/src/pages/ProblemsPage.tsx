import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { AnalysisReportView } from '../components/AnalysisReportView'
import { AttachmentField } from '../components/AttachmentField'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/ToastProvider'
import { requestJson } from '../lib/http'
import type { Attachment, Problem, ProblemAnalysisReport, ProblemDetail } from '../types'

type Props = {
  userId: number
}

type CriteriaDraft = {
  key: string
  description: string
  type: 'quantified' | 'behavioral'
}

type ProblemForm = {
  title: string
  scenario: string
  background: string
  frequency: string
  impact_scope: string
  description: string
  value_reduce_effort: boolean
  value_reduce_cost: boolean
  value_improve_quality: boolean
  value_statement: string
  current_solution: string
  draft_goal: string
  draft_scope: string
  draft_due_date: string
  submitter_reflection: string
  criteria: CriteriaDraft[]
}

type ProblemFilters = {
  status: string
  scenario: string
  created_from: string
  created_to: string
}

const defaultForm: ProblemForm = {
  title: '',
  scenario: 'rd',
  background: '',
  frequency: 'weekly',
  impact_scope: 'team',
  description: '',
  value_reduce_effort: true,
  value_reduce_cost: false,
  value_improve_quality: false,
  value_statement: '',
  current_solution: '',
  draft_goal: '',
  draft_scope: '',
  draft_due_date: '',
  submitter_reflection: '',
  criteria: [{ key: 'criteria-1', description: '', type: 'quantified' }],
}

const defaultFilters: ProblemFilters = {
  status: '',
  scenario: '',
  created_from: '',
  created_to: '',
}

function normalizeCriteria(
  list: Array<{ description?: string; type?: string }> | undefined,
): CriteriaDraft[] {
  if (!list || list.length === 0) {
    return [{ key: 'criteria-1', description: '', type: 'quantified' }]
  }
  return list.map((item, idx) => ({
    key: `criteria-${idx + 1}`,
    description: item.description ?? '',
    type: item.type === 'behavioral' ? 'behavioral' : 'quantified',
  }))
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

function problemStatusTone(status: string): 'success' | 'warn' | 'danger' | 'info' | 'muted' {
  if (status === 'approved' || status === 'archived') return 'success'
  if (status === 'pending_review' || status === 'budget_pending' || status === 'pricing_revision_required') return 'warn'
  if (status === 'rejected') return 'danger'
  if (status === 'draft') return 'info'
  return 'muted'
}

export function ProblemsPage({ userId }: Props) {
  const toast = useToast()
  const [form, setForm] = useState<ProblemForm>(defaultForm)
  const [filters, setFilters] = useState<ProblemFilters>(defaultFilters)
  const [list, setList] = useState<Problem[]>([])
  const [uploadedAttachments, setUploadedAttachments] = useState<Attachment[]>([])
  const [editingProblemId, setEditingProblemId] = useState<number | null>(null)
  const [detailProblemId, setDetailProblemId] = useState<number | null>(null)
  const [detailData, setDetailData] = useState<ProblemDetail | null>(null)
  const [detailAttachments, setDetailAttachments] = useState<Attachment[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [analysisProblemId, setAnalysisProblemId] = useState<number | null>(null)
  const [analysisDetail, setAnalysisDetail] = useState<ProblemAnalysisReport | null>(null)
  const [analysisDetailLoading, setAnalysisDetailLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleUploadedAttachmentsChange = (next: Attachment[]) => {
    setUploadedAttachments(next)
  }

  const buildMineQuery = useCallback(() => {
    const params = new URLSearchParams()
    params.set('mine_only', 'true')
    if (filters.status) params.set('status', filters.status)
    if (filters.scenario) params.set('scenario', filters.scenario)
    if (filters.created_from) params.set('created_from', filters.created_from)
    if (filters.created_to) params.set('created_to', filters.created_to)
    return `/problems?${params.toString()}`
  }, [filters.created_from, filters.created_to, filters.scenario, filters.status])

  const loadMine = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await requestJson<Problem[]>(buildMineQuery(), { userId })
      setList(rows)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [buildMineQuery, userId])

  useEffect(() => {
    void loadMine()
  }, [loadMine])

  const startEdit = async (problemId: number) => {
    try {
      setError(null)
      const [detail, attachments] = await Promise.all([
        requestJson<ProblemDetail>(`/problems/${problemId}`, { userId }),
        requestJson<Attachment[]>(`/entities/problem/${problemId}/attachments`, { userId }),
      ])
      setForm({
        title: detail.title,
        scenario: detail.scenario,
        background: detail.background,
        frequency: detail.frequency,
        impact_scope: detail.impact_scope,
        description: detail.description,
        value_reduce_effort: detail.value_reduce_effort,
        value_reduce_cost: detail.value_reduce_cost,
        value_improve_quality: detail.value_improve_quality,
        value_statement: detail.value_statement,
        current_solution: detail.current_solution ?? '',
        draft_goal: detail.draft_goal ?? '',
        draft_scope: detail.draft_scope ?? '',
        draft_due_date: detail.draft_due_date ?? '',
        submitter_reflection: detail.submitter_reflection ?? '',
        criteria: normalizeCriteria(detail.draft_acceptance_criteria),
      })
      setUploadedAttachments(attachments)
      setEditingProblemId(problemId)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载问题详情失败')
    }
  }

  const cancelEdit = () => {
    setEditingProblemId(null)
    setForm(defaultForm)
    setUploadedAttachments([])
  }

  const addCriteria = () => {
    setForm((prev) => ({
      ...prev,
      criteria: [...prev.criteria, { key: `criteria-${Date.now()}`, description: '', type: 'quantified' }],
    }))
  }

  const removeCriteria = (key: string) => {
    setForm((prev) => {
      const next = prev.criteria.filter((item) => item.key !== key)
      return {
        ...prev,
        criteria: next.length > 0 ? next : [{ key: 'criteria-1', description: '', type: 'quantified' }],
      }
    })
  }

  const buildTaskDraftPayload = () => {
    const criteria = form.criteria
      .map((item) => ({ description: item.description.trim(), type: item.type }))
      .filter((item) => item.description)

    if (!form.draft_goal.trim() || !form.draft_scope.trim() || !form.draft_due_date || !form.submitter_reflection.trim()) {
      return null
    }
    if (criteria.length === 0) {
      return null
    }

    return {
      goal: form.draft_goal.trim(),
      scope: form.draft_scope.trim(),
      due_date: form.draft_due_date,
      acceptance_criteria: criteria,
      self_reflection: form.submitter_reflection.trim(),
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      setMessage(null)
      setError(null)
      const isResubmit = editingProblemId !== null
      const path = isResubmit ? `/problems/${editingProblemId}/resubmit` : '/problems'
      await requestJson(path, {
        method: isResubmit ? 'PUT' : 'POST',
        userId,
        body: {
          title: form.title,
          scenario: form.scenario,
          background: form.background,
          frequency: form.frequency,
          impact_scope: form.impact_scope,
          description: form.description,
          value_reduce_effort: form.value_reduce_effort,
          value_reduce_cost: form.value_reduce_cost,
          value_improve_quality: form.value_improve_quality,
          value_statement: form.value_statement,
          current_solution: form.current_solution.trim() || null,
          task_draft: buildTaskDraftPayload(),
          attachment_ids: uploadedAttachments.map((item) => item.id),
          attachment_urls: [],
        },
      })
      setMessage(isResubmit ? '问题草稿已更新' : '问题草稿已创建')
      setEditingProblemId(null)
      setForm(defaultForm)
      setUploadedAttachments([])
      await loadMine()
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败')
    }
  }

  const submitForReview = async (problemId: number) => {
    try {
      setError(null)
      await requestJson(`/problems/${problemId}/submit-for-review`, {
        method: 'POST',
        userId,
      })
      setMessage(`问题 #${problemId} 已提交评审，ProdMind 已自动开始论证`)
      await loadMine()
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
      await loadMine()
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
        requestJson<ProblemDetail>(`/problems/${problemId}`, { userId }),
        requestJson<Attachment[]>(`/entities/problem/${problemId}/attachments`, { userId }),
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
      const detail = await requestJson<ProblemAnalysisReport>(`/problems/${problemId}/analysis`, { userId })
      setAnalysisDetail(detail)
    } catch (err) {
      setAnalysisDetail(null)
      setError(err instanceof Error ? err.message : '加载论证详情失败')
    } finally {
      setAnalysisDetailLoading(false)
    }
  }

  const canEditStatus = useMemo(
    () => new Set(['draft', 'rejected']),
    [],
  )

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>{editingProblemId ? '编辑问题草稿' : '问题草稿提交'}</h2>
        <p>先由提交人完善任务定义，再送审。提交评审后会自动触发 ProdMind 论证。</p>
      </header>

      <form className="panel form-grid" onSubmit={submit}>
        <label>
          标题
          <input value={form.title} maxLength={50} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} required />
        </label>
        <label>
          场景
          <select value={form.scenario} onChange={(e) => setForm((p) => ({ ...p, scenario: e.target.value }))}>
            <option value="rd">研发</option>
            <option value="ops">运维</option>
            <option value="delivery">交付</option>
            <option value="support">支持</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label>
          频率
          <select value={form.frequency} onChange={(e) => setForm((p) => ({ ...p, frequency: e.target.value }))}>
            <option value="daily">每日</option>
            <option value="weekly">每周</option>
            <option value="monthly">每月</option>
            <option value="quarterly">季度</option>
            <option value="occasional">偶发</option>
          </select>
        </label>
        <label>
          影响范围
          <select value={form.impact_scope} onChange={(e) => setForm((p) => ({ ...p, impact_scope: e.target.value }))}>
            <option value="individual">个人</option>
            <option value="team">团队</option>
            <option value="department">部门</option>
            <option value="company">公司</option>
          </select>
        </label>
        <label className="wide">
          背景
          <textarea value={form.background} onChange={(e) => setForm((p) => ({ ...p, background: e.target.value }))} required />
        </label>
        <label className="wide">
          问题描述
          <textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} required />
        </label>
        <label className="wide">
          价值说明
          <textarea value={form.value_statement} onChange={(e) => setForm((p) => ({ ...p, value_statement: e.target.value }))} required />
        </label>
        <label className="wide">
          当前解决方式（可选）
          <textarea value={form.current_solution} onChange={(e) => setForm((p) => ({ ...p, current_solution: e.target.value }))} />
        </label>

        <AttachmentField userId={userId} value={uploadedAttachments} onChange={handleUploadedAttachmentsChange} label="附件上传" />

        <div className="wide checks">
          <label>
            <input type="checkbox" checked={form.value_reduce_effort} onChange={(e) => setForm((p) => ({ ...p, value_reduce_effort: e.target.checked }))} />
            降低人力时间
          </label>
          <label>
            <input type="checkbox" checked={form.value_reduce_cost} onChange={(e) => setForm((p) => ({ ...p, value_reduce_cost: e.target.checked }))} />
            降低成本返工
          </label>
          <label>
            <input type="checkbox" checked={form.value_improve_quality} onChange={(e) => setForm((p) => ({ ...p, value_improve_quality: e.target.checked }))} />
            提升质量稳定性
          </label>
        </div>

        <h3 className="wide">提交人任务定义</h3>
        <label className="wide">
          任务目标
          <textarea value={form.draft_goal} onChange={(e) => setForm((p) => ({ ...p, draft_goal: e.target.value }))} />
        </label>
        <label className="wide">
          任务范围
          <textarea value={form.draft_scope} onChange={(e) => setForm((p) => ({ ...p, draft_scope: e.target.value }))} />
        </label>
        <label>
          目标截止日期
          <input type="date" value={form.draft_due_date} onChange={(e) => setForm((p) => ({ ...p, draft_due_date: e.target.value }))} />
        </label>
        <label className="wide">
          自我复盘
          <textarea value={form.submitter_reflection} onChange={(e) => setForm((p) => ({ ...p, submitter_reflection: e.target.value }))} />
        </label>

        <div className="wide">
          <div className="panel-headline">
            <h3>验收标准</h3>
            <button type="button" onClick={addCriteria}>新增</button>
          </div>
          {form.criteria.map((item) => (
            <div key={item.key} className="acceptance-editor">
              <label>
                描述
                <input
                  value={item.description}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      criteria: prev.criteria.map((row) =>
                        row.key === item.key ? { ...row, description: e.target.value } : row,
                      ),
                    }))
                  }
                />
              </label>
              <label>
                类型
                <select
                  value={item.type}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      criteria: prev.criteria.map((row) =>
                        row.key === item.key ? { ...row, type: e.target.value as 'quantified' | 'behavioral' } : row,
                      ),
                    }))
                  }
                >
                  <option value="quantified">量化</option>
                  <option value="behavioral">行为</option>
                </select>
              </label>
              <button type="button" onClick={() => removeCriteria(item.key)}>删除</button>
            </div>
          ))}
        </div>

        <div className="button-row wide">
          <button className="primary-btn" type="submit">{editingProblemId ? '保存草稿' : '创建草稿'}</button>
          {editingProblemId && <button type="button" onClick={cancelEdit}>取消编辑</button>}
        </div>
      </form>

      <form className="panel form-grid" onSubmit={(event) => { event.preventDefault(); void loadMine() }}>
        <h3>我的问题筛选</h3>
        <label>
          状态
          <select value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
            <option value="">全部</option>
            <option value="draft">草稿</option>
            <option value="pending_review">待评审</option>
            <option value="pricing_revision_required">待重新定价</option>
            <option value="budget_pending">待资金复核</option>
            <option value="approved">已立项</option>
            <option value="rejected">不立项</option>
            <option value="archived">已归档</option>
          </select>
        </label>
        <label>
          场景
          <select value={filters.scenario} onChange={(e) => setFilters((p) => ({ ...p, scenario: e.target.value }))}>
            <option value="">全部</option>
            <option value="rd">研发</option>
            <option value="ops">运维</option>
            <option value="delivery">交付</option>
            <option value="support">支持</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label>
          起始日期
          <input type="date" value={filters.created_from} onChange={(e) => setFilters((p) => ({ ...p, created_from: e.target.value }))} />
        </label>
        <label>
          截止日期
          <input type="date" value={filters.created_to} onChange={(e) => setFilters((p) => ({ ...p, created_to: e.target.value }))} />
        </label>
        <div className="button-row wide">
          <button className="primary-btn" type="submit" disabled={loading}>筛选</button>
          <button type="button" onClick={() => setFilters(defaultFilters)} disabled={loading}>重置</button>
        </div>
      </form>

      <article className="panel">
        <div className="panel-headline">
          <h3>我的问题</h3>
          <button type="button" onClick={() => void loadMine()} disabled={loading}>刷新</button>
        </div>
        <div className="table">
          <div className="row head wide-row problems-row">
            <span>ID</span>
            <span>标题</span>
            <span>场景</span>
            <span>状态</span>
            <span>论证状态</span>
            <span>评审意见</span>
            <span>时间</span>
            <span>操作</span>
          </div>
          {list.map((item) => (
            <div className="row wide-row problems-row" key={item.id}>
              <span>#{item.id}</span>
              <span>{item.title}</span>
              <span>{item.scenario}</span>
              <span>
                <StatusBadge tone={problemStatusTone(item.status)}>{item.status}</StatusBadge>
              </span>
              <span>
                <StatusBadge tone={analysisTone(item.analysis_status)}>
                  {formatAnalysisStatus(item.analysis_status)}
                </StatusBadge>
              </span>
              <span>{item.reviewer_comment ?? item.reject_reason ?? '-'}</span>
            <span>{new Date(item.created_at).toLocaleDateString()}</span>
            <span className="actions">
              <button type="button" onClick={() => void openProblemDetail(item.id)}>查看详情</button>
              {canEditStatus.has(item.status) && (
                <button type="button" onClick={() => void startEdit(item.id)}>编辑</button>
              )}
              {item.status === 'draft' && (
                <button type="button" onClick={() => void submitForReview(item.id)}>提交评审</button>
                )}
                {(item.analysis_status === 'completed' || item.analysis_status === 'failed') && (
                  <button type="button" onClick={() => void openAnalysisDetail(item.id)}>查看论证</button>
                )}
                {item.status !== 'archived' && item.status !== 'rejected' && (
                  <button type="button" onClick={() => void triggerAnalysisNow(item.id)}>立即论证</button>
                )}
              </span>
            </div>
          ))}
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
                <section className="modal-section">
                  <h4>基础信息</h4>
                  <p className="line-metric"><span>标题</span><strong>{detailData.title}</strong></p>
                  <p className="line-metric"><span>场景</span><strong>{detailData.scenario}</strong></p>
                  <p className="line-metric"><span>频率</span><strong>{detailData.frequency}</strong></p>
                  <p className="line-metric"><span>影响范围</span><strong>{detailData.impact_scope}</strong></p>
                  <p className="line-metric"><span>状态</span><strong>{detailData.status}</strong></p>
                  <p className="line-metric"><span>提交人</span><strong>{detailData.submitter_name}</strong></p>
                </section>
                <section className="modal-section">
                  <h4>问题内容</h4>
                  <p><strong>背景：</strong>{detailData.background}</p>
                  <p><strong>问题描述：</strong>{detailData.description}</p>
                  <p><strong>价值说明：</strong>{detailData.value_statement}</p>
                  <p><strong>当前解决方式：</strong>{detailData.current_solution || '-'}</p>
                </section>
                <section className="modal-section">
                  <h4>提交人任务定义</h4>
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
                <section className="modal-section">
                  <h4>评审与定价</h4>
                  <p><strong>评审意见：</strong>{detailData.reviewer_comment || detailData.reject_reason || '-'}</p>
                  <p><strong>任务等级：</strong>{detailData.priced_level || '-'}</p>
                  <p><strong>奖励总额：</strong>{detailData.priced_reward_total ?? '-'}</p>
                  <p><strong>提交人分成比例：</strong>{detailData.priced_proposer_ratio ?? '-'}</p>
                  <p><strong>积分：</strong>{detailData.priced_points ?? '-'}</p>
                  <p><strong>徽章：</strong>{detailData.priced_badge || '-'}</p>
                </section>
                <section className="modal-section">
                  <h4>附件</h4>
                  {detailAttachments.length > 0 ? (
                    <ul>
                      {detailAttachments.map((file) => (
                        <li key={file.id}>
                          <a href={file.download_url} target="_blank" rel="noreferrer">
                            {file.filename}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>无附件</p>
                  )}
                </section>
              </>
            ) : (
              <p>暂无问题详情</p>
            )}
          </div>
        </div>
      )}

      {analysisProblemId !== null && (
        <div className="modal-backdrop" onClick={() => { setAnalysisProblemId(null); setAnalysisDetail(null) }}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="论证详情"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-headline">
              <h3>ProdMind 论证详情（问题 #{analysisProblemId}）</h3>
              <button type="button" onClick={() => { setAnalysisProblemId(null); setAnalysisDetail(null) }}>
                关闭
              </button>
            </div>
            {analysisDetailLoading ? (
              <p>加载中...</p>
            ) : analysisDetail ? (
              <AnalysisReportView analysis={analysisDetail} />
            ) : (
              <p>暂无论证详情</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
