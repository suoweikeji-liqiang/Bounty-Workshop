import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { ProblemDraftForm } from '../components/ProblemDraftForm'
import { useToast } from '../components/ToastProvider'
import { getProblemDetail, listProblemAttachments } from '../lib/api'
import { requestJson } from '../lib/http'
import type { Attachment, ProblemDetail, ProblemDraftFormState } from '../types'

type Props = {
  userId: number
}

const defaultForm: ProblemDraftFormState = {
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

function normalizeCriteria(
  list: Array<{ description?: string; type?: string }> | undefined,
): ProblemDraftFormState['criteria'] {
  if (!list || list.length === 0) {
    return [{ key: 'criteria-1', description: '', type: 'quantified' }]
  }
  return list.map((item, idx) => ({
    key: `criteria-${idx + 1}`,
    description: item.description ?? '',
    type: item.type === 'behavioral' ? 'behavioral' : 'quantified',
  }))
}

function toForm(detail: ProblemDetail): ProblemDraftFormState {
  return {
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
  }
}

function buildTaskDraftPayload(form: ProblemDraftFormState) {
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

function resolveBackPath(rawBack: string | null): string {
  if (!rawBack) {
    return '/problems'
  }
  try {
    const decoded = decodeURIComponent(rawBack)
    if (decoded.startsWith('/problems')) {
      return decoded
    }
    return '/problems'
  } catch {
    return '/problems'
  }
}

export function ProblemDraftEditorPage({ userId }: Props) {
  const toast = useToast()
  const navigate = useNavigate()
  const { problemId } = useParams<{ problemId: string }>()
  const [searchParams] = useSearchParams()
  const backPath = useMemo(() => resolveBackPath(searchParams.get('back')), [searchParams])
  const editingProblemId = useMemo(() => {
    if (!problemId) return null
    const parsed = Number(problemId)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }, [problemId])
  const isEditMode = editingProblemId !== null

  const [form, setForm] = useState<ProblemDraftFormState>(defaultForm)
  const [uploadedAttachments, setUploadedAttachments] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isEditMode || editingProblemId === null) {
      return
    }
    let active = true
    setLoading(true)
    Promise.all([
      getProblemDetail(userId, editingProblemId),
      listProblemAttachments(userId, editingProblemId),
    ])
      .then(([detail, attachments]) => {
        if (!active) return
        setForm(toForm(detail))
        setUploadedAttachments(attachments)
      })
      .catch((err) => {
        if (!active) return
        toast.error(err instanceof Error ? err.message : '加载问题详情失败')
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [editingProblemId, isEditMode, toast, userId])

  const submitDraft = async (event: FormEvent) => {
    event.preventDefault()
    try {
      setSaving(true)
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
          task_draft: buildTaskDraftPayload(form),
          attachment_ids: uploadedAttachments.map((item) => item.id),
          attachment_urls: [],
        },
      })
      toast.success(isResubmit ? '问题草稿已更新' : '问题草稿已创建')
      navigate(backPath, { replace: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="page-wrap">
      <header className="page-head">
        <h2>{isEditMode ? '编辑问题草稿' : '新建问题草稿'}</h2>
        <p>在独立页面完成草稿编辑，保存后自动返回问题列表。</p>
      </header>
      {loading ? (
        <article className="panel">
          <p>加载中...</p>
        </article>
      ) : (
        <ProblemDraftForm
          userId={userId}
          form={form}
          setForm={setForm}
          uploadedAttachments={uploadedAttachments}
          onUploadedAttachmentsChange={setUploadedAttachments}
          onSubmit={submitDraft}
          submitLabel={isEditMode ? '保存草稿' : '创建草稿'}
          submitting={saving}
          onCancel={() => navigate(backPath)}
        />
      )}
    </section>
  )
}
