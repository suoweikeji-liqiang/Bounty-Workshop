import type { Dispatch, FormEvent, SetStateAction } from 'react'

import type { Attachment, ProblemDraftFormState } from '../types'
import { AttachmentField } from './AttachmentField'

type Props = {
  userId: number
  form: ProblemDraftFormState
  setForm: Dispatch<SetStateAction<ProblemDraftFormState>>
  uploadedAttachments: Attachment[]
  onUploadedAttachmentsChange: (next: Attachment[]) => void
  onSubmit: (event: FormEvent) => void
  submitLabel: string
  submitting?: boolean
  onCancel?: () => void
}

export function ProblemDraftForm({
  userId,
  form,
  setForm,
  uploadedAttachments,
  onUploadedAttachmentsChange,
  onSubmit,
  submitLabel,
  submitting = false,
  onCancel,
}: Props) {
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

  return (
    <form className="panel form-grid" onSubmit={onSubmit}>
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

      <AttachmentField userId={userId} value={uploadedAttachments} onChange={onUploadedAttachmentsChange} label="附件上传" />

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
        {onCancel && (
          <button type="button" onClick={onCancel}>
            返回列表
          </button>
        )}
        <button className="primary-btn" type="submit" disabled={submitting}>
          {submitting ? '提交中...' : submitLabel}
        </button>
      </div>
    </form>
  )
}
