export type Overview = {
  problem_total: number
  problem_approved: number
  task_total: number
  task_completed: number
  task_overdue_claims: number
  task_completion_rate: number
  task_overdue_rate: number
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
  reject_reason?: string | null
  merged_problem_id?: number | null
  analysis_status?: AnalysisStatus
  reviewer_comment?: string | null
  submitter_id: number
  submitter_name: string
  created_at: string
}

export type ProblemDraftCriteria = {
  key: string
  description: string
  type: 'quantified' | 'behavioral'
}

export type ProblemDraftFormState = {
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
  criteria: ProblemDraftCriteria[]
}

export type ProblemDetail = {
  id: number
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
  current_solution: string | null
  attachment_urls: string[]
  status: string
  reject_reason: string | null
  merged_problem_id: number | null
  submitter_id: number
  submitter_name: string
  created_at: string
  draft_goal?: string | null
  draft_scope?: string | null
  draft_due_date?: string | null
  draft_acceptance_criteria?: Array<{ description?: string; type?: string }>
  submitter_reflection?: string | null
  reviewer_comment?: string | null
  priced_level?: string | null
  priced_reward_total?: number | null
  priced_proposer_ratio?: number | null
  priced_accepter_id?: number | null
  priced_points?: number
  priced_badge?: string | null
  priced_is_complex?: boolean
  priced_closing_reward_ratio?: number
  priced_milestones?: Array<{
    sequence?: number
    title?: string
    goal?: string
    due_date?: string | null
    reward_ratio?: number
    acceptance_criteria?: Array<{ description?: string; type?: string }>
  }>
  // ProdMind analysis fields
  analysis_id?: number | null
  analysis_status?: AnalysisStatus
  analysis?: ProblemAnalysisReport | null
  analysis_ref?: ProblemReviewAnalysisRef | null
}

export type ProblemReviewResult = {
  status: string
  message?: string | null
  task?: Task | null
  id?: number | null
}

export type ProblemReviewAnalysisRef = {
  id: number
  problem_id: number
  recommendation: string
  analysis_id: number
  acceptance_reason: string | null
  rejection_reason: string | null
  reviewed_by: number
  created_at: string
}

export type Task = {
  id: number
  problem_id: number
  title: string
  scenario: string
  level: string
  reward_total: number
  is_complex: boolean
  active_claim_count: number
  active_claims: TaskActiveClaim[]
  due_date: string
  status: string
  created_at: string
}

export type TaskActiveClaim = {
  claim_id: number
  mode: 'individual' | 'team'
  status: string
  lead_user_id: number
  lead_user_name: string
  team_size: number
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
  is_complex: boolean
  closing_reward_ratio: number
  acceptance_criteria: Array<{ description?: string; type?: string }>
  status: string
  created_at: string
}

export type TaskActivityType =
  | 'comment'
  | 'progress_update'
  | 'blocker'
  | 'official_note'
  | 'system_event'

export type TaskActivity = {
  id: number
  task_id: number
  claim_id: number | null
  activity_type: TaskActivityType
  actor_user_id: number
  actor_user_name?: string | null
  claim_name?: string | null
  content: string
  detail: Record<string, unknown>
  attachment_urls: string[]
  created_at: string
}

export type MilestoneStatus =
  | 'pending'
  | 'active'
  | 'pending_acceptance'
  | 'approved'
  | 'rework'
  | 'cancelled'

export type TaskMilestoneDefinition = {
  sequence: number
  title: string
  goal: string
  due_date?: string | null
  reward_ratio: number
  acceptance_criteria: Array<{ description: string; type: 'quantified' | 'behavioral' }>
}

export type MilestoneSubmission = {
  id: number
  milestone_id: number
  claim_id: number
  summary: string
  evidence_urls: string[]
  criteria_results: string[]
  submitted_by_user_id: number
  submitted_at: string
}

export type TaskMilestone = {
  id: number
  task_id: number
  sequence: number
  title: string
  goal: string
  due_date: string | null
  acceptance_criteria: Array<{ description?: string; type?: string }>
  reward_ratio: number
  status: MilestoneStatus
  latest_submission: MilestoneSubmission | null
  created_at: string
  updated_at: string
}

export type MilestonePendingAcceptance = {
  milestone_id: number
  task_id: number
  task_title: string
  sequence: number
  claim_id: number
  claim_mode: string
  lead_user_name?: string | null
  submitted_at: string
  submitted_by_user_id: number
  submitted_by_user_name?: string | null
  status: MilestoneStatus
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
  has_password: boolean
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
  badge_details: UserBadgeDetail[]
  rewards: Reward[]
}

export type BadgeDefinition = {
  code: string
  name: string
  category: string
  description: string
  icon: string
  auto_enabled: boolean
}

export type UserBadgeDetail = BadgeDefinition & {
  source_type: string
  source_id: number | null
  earned_at: string
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
  budget_review_threshold: number
  acceptance_templates: AcceptanceTemplatesConfig
}

export type BudgetReviewThresholdConfig = {
  threshold: number
}

export type SystemVersion = {
  backend_version: string
  backend_git_sha: string
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
  claim_mode: string
  task_id: number
  task_title: string
  lead_user_id: number
  lead_user_name?: string | null
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
  task_title?: string | null
  user_id: number
  user_name?: string | null
  role_type: string
  amount: number
  points: number
  badge: string | null
  status: string
  confirmed_at: string | null
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
  actor_user_name?: string | null
  action: string
  target_type: string
  target_id: number | null
  detail: Record<string, unknown>
  created_at: string
}

export type AIProvider = 'openai' | 'anthropic' | 'deepseek' | 'siliconflow' | 'ollama' | 'custom'

export type AIModel = {
  id: number
  name: string
  provider: AIProvider
  api_base_url: string
  has_api_key: boolean
  model: string
  is_default: boolean
  enabled: boolean
  max_tokens: number
  temperature: number
  timeout: number
  created_at: string
  updated_at: string
}

export type AnalysisStatus = 'pending' | 'analyzing' | 'completed' | 'failed'

export type HypothesisStatus = 'pending' | 'verified' | 'rejected'
export type HypothesisType = 'market' | 'technical' | 'requirement'
export type RiskLevel = 'high' | 'medium' | 'low'

export type HypothesisItem = {
  content: string
  hypothesis_type: HypothesisType
  risk_level: RiskLevel
  verification_method: string
}

export type ProblemAnalysisReport = {
  id: number
  problem_id: number
  status: AnalysisStatus
  recommendation: string | null
  confidence: number | null
  rounds: number
  error_message: string | null
  report: {
    architect: {
      core_problem: string | null
      target_users: string[]
      problem_boundaries: string | null
      success_criteria: string | null
    }
    assassin: {
      assumptions_challenged: Array<{ assumption: string; challenge: string }>
      risks_identified: Array<{ risk: string; severity: RiskLevel; mitigation: string }>
      alternative_views: string[]
    }
    user_ghost: {
      user_questions: string[]
      user_value_priorities: string[]
      edge_cases: string[]
    }
    grounder: {
      hypothesis_list: HypothesisItem[]
      falsification_checks: string[]
      mvp_boundaries: string | null
      next_actions: string[]
      recommendation: string | null
      confidence: number | null
    }
  }
  created_at: string
  updated_at: string
}

export type HypothesisVerification = {
  id: number
  analysis_id: number
  hypothesis_content: string
  hypothesis_type: HypothesisType
  risk_level: RiskLevel
  verification_status: HypothesisStatus
  verification_method: string | null
  verification_result: string | null
  verified_by: number | null
  verified_at: string | null
  created_at: string
}
