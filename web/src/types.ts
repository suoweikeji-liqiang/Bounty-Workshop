export type Overview = {
  problem_total: number
  problem_approved: number
  task_total: number
  task_completed: number
  task_overdue_claims: number
  reward_total_confirmed_amount: number
}

export type RankingItem = {
  user_id: number
  user_name: string
  value: number
}

export type Rankings = {
  claim_count_ranking: RankingItem[]
  reward_amount_ranking: RankingItem[]
  problem_contribution_ranking: RankingItem[]
  points_ranking: RankingItem[]
}

export type TrendPoint = {
  period: string
  problem_submitted: number
  task_completed: number
  reward_confirmed_amount: number
}

export type Trends = {
  granularity: 'week' | 'month'
  points: TrendPoint[]
}

export type DistributionItem = {
  name: string
  count: number
}

export type Distribution = {
  scenario_distribution: DistributionItem[]
  level_distribution: DistributionItem[]
  department_distribution: DistributionItem[]
}

export type Problem = {
  id: number
  title: string
  scenario: string
  status: string
  submitter_id: number
  created_at: string
}

export type Task = {
  id: number
  problem_id: number
  title: string
  level: string
  reward_total: number
  due_date: string
  status: string
  created_at: string
}

export type Attachment = {
  id: number
  filename: string
  content_type: string
  size_bytes: number
  checksum_sha256: string
  storage_backend: string
  bucket: string | null
  uploader_user_id: number
  entity_type: string | null
  entity_id: number | null
  download_url: string
  created_at: string
}

export type Department = {
  id: number
  external_id: string
  name: string
  parent_external_id: string | null
  leader_external_user_id: string | null
  updated_at: string
}

export type UserProfile = {
  id: number
  name: string
  employee_no: string | null
  department: string | null
  email: string | null
  status: string
  overdue_count: number
  roles: string[]
}

export type ClaimExecution = {
  claim_id: number
  claim_status: string
  claim_mode: string
  task_id: number
  task_title: string
  task_status: string
  due_date: string
  deliverable_id: number | null
  deliverable_status: string | null
  deliverable_submitted_at: string | null
}

export type PendingAcceptance = {
  deliverable_id: number
  claim_id: number
  task_id: number
  task_title: string
  lead_user_id: number
  submitted_at: string
  deliverable_status: string
}

export type AcceptanceHistoryItem = {
  acceptance_id: number
  accepter_id: number
  result: string
  comment: string | null
  created_at: string
}

export type AcceptanceTemplatesConfig = {
  approved: string[]
  rework: string[]
  rejected: string[]
}

export type ClaimExecutionDetail = {
  claim_id: number
  claim_status: string
  claim_mode: string
  lead_user_id: number
  task_id: number
  task_title: string
  task_goal: string
  task_scope: string
  task_status: string
  due_date: string
  acceptance_criteria: Array<{ description?: string; type?: string }>
  deliverable_id: number | null
  deliverable_status: string | null
  deliverable_summary: string | null
  evidence_urls: string[]
  criteria_results: string[]
  submitted_at: string | null
  acceptance_history: AcceptanceHistoryItem[]
}

export type Reward = {
  id: number
  task_id: number
  user_id: number
  role_type: string
  amount: number
  points: number
  badge: string | null
  status: string
  confirmed_at: string | null
}
