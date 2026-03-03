import { requestJson } from './http'
import type {
  Attachment,
  MilestonePendingAcceptance,
  Problem,
  ProblemDetail,
  TaskActivity,
  TaskActivityType,
  TaskMilestone,
  TaskMilestoneDefinition,
} from '../types'

export type ProblemListFilters = {
  mine_only: boolean
  status: string
  scenario: string
  created_from: string
  created_to: string
}

export function buildProblemListPath(filters: ProblemListFilters): string {
  const params = new URLSearchParams()
  if (filters.mine_only) {
    params.set('mine_only', 'true')
  }
  if (filters.status) params.set('status', filters.status)
  if (filters.scenario) params.set('scenario', filters.scenario)
  if (filters.created_from) params.set('created_from', filters.created_from)
  if (filters.created_to) params.set('created_to', filters.created_to)
  return `/problems?${params.toString()}`
}

export async function listProblems(userId: number, filters: ProblemListFilters): Promise<Problem[]> {
  return requestJson<Problem[]>(buildProblemListPath(filters), { userId })
}

export async function getProblemDetail(userId: number, problemId: number): Promise<ProblemDetail> {
  return requestJson<ProblemDetail>(`/problems/${problemId}`, { userId })
}

export async function listProblemAttachments(userId: number, problemId: number): Promise<Attachment[]> {
  return requestJson<Attachment[]>(`/entities/problem/${problemId}/attachments`, { userId })
}

export async function listTaskActivities(userId: number, taskId: number): Promise<TaskActivity[]> {
  return requestJson<TaskActivity[]>(`/tasks/${taskId}/activities`, { userId })
}

export async function listClaimActivities(userId: number, claimId: number): Promise<TaskActivity[]> {
  return requestJson<TaskActivity[]>(`/claims/${claimId}/activities`, { userId })
}

export async function createTaskActivity(
  userId: number,
  taskId: number,
  payload: {
    claim_id?: number
    activity_type: Extract<TaskActivityType, 'comment' | 'progress_update' | 'blocker'>
    content: string
    detail?: Record<string, unknown>
  },
): Promise<TaskActivity> {
  return requestJson<TaskActivity>(`/tasks/${taskId}/activities`, {
    method: 'POST',
    userId,
    body: payload,
  })
}

export async function listTaskMilestones(userId: number, taskId: number): Promise<TaskMilestone[]> {
  return requestJson<TaskMilestone[]>(`/tasks/${taskId}/milestones`, { userId })
}

export async function configureTaskMilestones(
  userId: number,
  taskId: number,
  milestones: TaskMilestoneDefinition[],
): Promise<TaskMilestone[]> {
  return requestJson<TaskMilestone[]>(`/tasks/${taskId}/milestones`, {
    method: 'POST',
    userId,
    body: milestones,
  })
}

export async function submitMilestone(
  userId: number,
  milestoneId: number,
  payload: {
    claim_id: number
    summary: string
    criteria_results: string[]
    evidence_urls?: string[]
    evidence_attachment_ids?: number[]
  },
): Promise<TaskMilestone> {
  return requestJson<TaskMilestone>(`/milestones/${milestoneId}/submit`, {
    method: 'POST',
    userId,
    body: payload,
  })
}

export async function acceptMilestone(
  userId: number,
  milestoneId: number,
  payload: {
    result: 'approved' | 'rework' | 'cancelled'
    comment?: string
  },
): Promise<{ milestone_id: number; result: string; status: string; next_milestone_id: number | null }> {
  return requestJson(`/milestones/${milestoneId}/accept`, {
    method: 'POST',
    userId,
    body: payload,
  })
}

export async function listMyPendingMilestoneAcceptance(userId: number): Promise<MilestonePendingAcceptance[]> {
  return requestJson<MilestonePendingAcceptance[]>('/milestones/pending-acceptance/mine', { userId })
}
