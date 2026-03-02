import { requestJson } from './http'
import type {
  MilestonePendingAcceptance,
  TaskActivity,
  TaskActivityType,
  TaskMilestone,
  TaskMilestoneDefinition,
} from '../types'

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

