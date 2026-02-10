export type Overview = {
  problem_total: number
  problem_approved: number
  task_total: number
  task_completed: number
  task_overdue_claims: number
  task_completion_rate: number
  task_overdue_rate: number
  reward_total_confirmed_amount: number
  performance_review_count: number
  performance_fault_count: number
  reward_hold_count: number
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
  baseline_responsibility_distribution: DistributionItem[]
  final_r_level_distribution: DistributionItem[]
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
  scenario: string
  level: string
  reward_total: number
  active_claim_count: number
  due_date: string
  status: string
  created_at: string
}

export type TaskDetail = {
  id: number
  problem_id: number
  title: string
  goal: string
  scope: string
  due_date: string
  level: string
  reward_total: number
  proposer_ratio: number
  accepter_id: number
  points: number
  badge: string | null
  acceptance_criteria: Array<{ description?: string; type?: string }>
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

export type AuthLoginResponse = {
  access_token: string
  token_type: string
  expires_in: number
  user: UserProfile
}

export type PersonalRewardStats = {
  total_records: number
  confirmed_records: number
  confirmed_reward_amount: number
  total_points: number
  confirmed_points: number
}

export type PersonalSummary = {
  user: UserProfile
  stats: PersonalRewardStats
  badges: string[]
  rewards: Reward[]
}

export type ClaimApprovalThresholdConfig = {
  threshold: number
}

export type SyncFrequencyConfig = {
  frequency_minutes: number
}

export type SystemConfigOverview = {
  feishu_sync_frequency_minutes: number
  release_overdue_frequency_minutes: number
  claim_approval_overdue_threshold: number
  acceptance_templates: AcceptanceTemplatesConfig
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

export type ClaimApprovalRequest = {
  id: number
  task_id: number
  task_title: string
  applicant_user_id: number
  applicant_user_name: string
  applicant_overdue_count: number
  status: string
  reason: string | null
  reviewed_by_user_id: number | null
  reviewed_at: string | null
  created_at: string
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

export type BaselineResponsibilityStatus = 'good' | 'normal' | 'fault'
export type IncidentSeverity = 'none' | 'minor' | 'major'
export type PerformanceLevel = 'R1' | 'R2' | 'R3' | 'R4' | 'R5'

export type PerformanceReviewSignalInput = {
  incident_severity: IncidentSeverity
  incident_count: number
  missed_deadline_count: number
  unjustified_delay_count: number
  process_violation_count: number
  known_risk_unreported: boolean
  repeated_issue_count: number
  critical_task_missed_without_reason: boolean
  repeated_issue_without_improvement: boolean
}

export type PerformanceReview = {
  claim_id: number
  task_id: number
  deliverable_id: number | null
  reviewed_by_user_id: number
  baseline_responsibility_status: BaselineResponsibilityStatus
  baseline_reasons: string[]
  incident_severity: IncidentSeverity
  incident_count: number
  missed_deadline_count: number
  unjustified_delay_count: number
  process_violation_count: number
  known_risk_unreported: boolean
  repeated_issue_count: number
  critical_task_missed_without_reason: boolean
  repeated_issue_without_improvement: boolean
  has_t3_plus_task: boolean
  initial_r_level: PerformanceLevel
  final_r_level: PerformanceLevel
  has_fault_warning: boolean
  created_at: string
  updated_at: string
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
  performance_review: PerformanceReview | null
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
  held_by_performance_policy: boolean
  performance_baseline_status: BaselineResponsibilityStatus | null
  performance_final_r_level: PerformanceLevel | null
  hold_reason: string | null
}

export type KnowledgeItem = {
  id: number
  task_id: number
  problem_summary: string
  solution_summary: string
  tags: string[]
  scenario: string | null
  level: string | null
  recommended: boolean
  archived_at: string
}

export type OperationLog = {
  id: number
  actor_user_id: number | null
  action: string
  target_type: string
  target_id: number | null
  detail: Record<string, unknown>
  created_at: string
}
