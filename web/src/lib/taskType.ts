import type { TaskType } from '../types'

export function resolveTaskType(taskType?: string | null, isComplex?: boolean | null): TaskType {
  if (taskType === 'complex' || taskType === 'mountain' || taskType === 'normal') {
    return taskType
  }
  return isComplex ? 'complex' : 'normal'
}

export function isMilestoneTaskType(taskType?: string | null, isComplex?: boolean | null): boolean {
  return resolveTaskType(taskType, isComplex) !== 'normal'
}

export function formatTaskTypeLabel(taskType?: string | null, isComplex?: boolean | null): string {
  const normalized = resolveTaskType(taskType, isComplex)
  if (normalized === 'mountain') return '山头任务'
  if (normalized === 'complex') return '复杂任务'
  return '普通任务'
}
