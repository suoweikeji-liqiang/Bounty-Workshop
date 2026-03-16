import { buildMilestoneDraft } from '../lib/milestoneDrafts'
import type { TaskMilestoneDefinition } from '../types'

type Props = {
  value: TaskMilestoneDefinition[]
  closingRewardRatio: number
  onChange: (next: TaskMilestoneDefinition[]) => void
  onClosingRewardRatioChange: (value: number) => void
  disabled?: boolean
}

function buildMilestone(sequence: number): TaskMilestoneDefinition {
  return buildMilestoneDraft(sequence)
}

export function MilestoneEditor({
  value,
  closingRewardRatio,
  onChange,
  onClosingRewardRatioChange,
  disabled = false,
}: Props) {
  const addMilestone = () => {
    if (value.length >= 5) return
    onChange([...value, buildMilestone(value.length + 1)])
  }

  const removeMilestone = (index: number) => {
    if (value.length <= 2) return
    const next = value.filter((_, idx) => idx !== index).map((item, idx) => ({ ...item, sequence: idx + 1 }))
    onChange(next)
  }

  const updateMilestone = (index: number, patch: Partial<TaskMilestoneDefinition>) => {
    onChange(value.map((item, idx) => (idx === index ? { ...item, ...patch } : item)))
  }

  const ratioSum = value.reduce((acc, item) => acc + Number(item.reward_ratio || 0), 0) + Number(closingRewardRatio || 0)
  const ratioValid = Math.abs(ratioSum - 1) < 0.0001

  return (
    <article className="panel">
      <div className="panel-headline">
        <h3>里程碑配置</h3>
        <button type="button" onClick={addMilestone} disabled={disabled || value.length >= 5}>
          添加里程碑
        </button>
      </div>
      <label>
        结项奖励比例（0-1）
        <input
          type="number"
          min="0.01"
          max="0.99"
          step="0.01"
          value={closingRewardRatio}
          onChange={(event) => onClosingRewardRatioChange(Number(event.target.value))}
          disabled={disabled}
        />
      </label>
      {value.map((item, index) => (
        <div className="acceptance-editor" key={`milestone-${item.sequence}`}>
          <div className="panel-headline">
            <h3>里程碑 {item.sequence}</h3>
            <button type="button" onClick={() => removeMilestone(index)} disabled={disabled || value.length <= 2}>
              删除
            </button>
          </div>
          <label>
            标题
            <input value={item.title} onChange={(event) => updateMilestone(index, { title: event.target.value })} disabled={disabled} />
          </label>
          <label>
            目标
            <textarea value={item.goal} onChange={(event) => updateMilestone(index, { goal: event.target.value })} disabled={disabled} />
          </label>
          <label>
            截止日期（可选）
            <input
              type="date"
              value={item.due_date ?? ''}
              onChange={(event) => updateMilestone(index, { due_date: event.target.value || null })}
              disabled={disabled}
            />
          </label>
          <label>
            奖励比例（0-1）
            <input
              type="number"
              min="0.01"
              max="0.99"
              step="0.01"
              value={item.reward_ratio}
              onChange={(event) => updateMilestone(index, { reward_ratio: Number(event.target.value) })}
              disabled={disabled}
            />
          </label>
          <label>
            验收标准
            <input
              value={item.acceptance_criteria[0]?.description ?? ''}
              onChange={(event) =>
                updateMilestone(index, {
                  acceptance_criteria: [{ description: event.target.value, type: item.acceptance_criteria[0]?.type ?? 'behavioral' }],
                })
              }
              disabled={disabled}
            />
          </label>
          <label>
            验收标准类型
            <select
              value={item.acceptance_criteria[0]?.type ?? 'behavioral'}
              onChange={(event) =>
                updateMilestone(index, {
                  acceptance_criteria: [{ description: item.acceptance_criteria[0]?.description ?? '', type: event.target.value as 'quantified' | 'behavioral' }],
                })
              }
              disabled={disabled}
            >
              <option value="behavioral">行为</option>
              <option value="quantified">量化</option>
            </select>
          </label>
        </div>
      ))}
      <p className="muted">
        比例校验：里程碑合计 + 结项 = {ratioSum.toFixed(2)} {ratioValid ? '（通过）' : '（必须等于 1）'}
      </p>
    </article>
  )
}
