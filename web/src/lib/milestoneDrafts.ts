import type { TaskMilestoneDefinition } from '../types'

export function buildMilestoneDraft(sequence: number): TaskMilestoneDefinition {
  return {
    sequence,
    title: `里程碑 ${sequence}`,
    goal: '',
    due_date: null,
    reward_ratio: 0.2,
    acceptance_criteria: [{ description: '', type: 'behavioral' }],
  }
}

export function buildDefaultMilestones(): TaskMilestoneDefinition[] {
  return [buildMilestoneDraft(1), buildMilestoneDraft(2)]
}
