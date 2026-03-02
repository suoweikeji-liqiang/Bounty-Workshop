from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.badges import is_valid_badge_code
from app.enums import (
    AcceptanceResult,
    AIProvider,
    AnalysisStatus,
    ClaimMode,
    HypothesisStatus,
    HypothesisType,
    MilestoneAcceptanceResult,
    MilestoneStatus,
    MilestoneRewardHoldStatus,
    ProblemFrequency,
    ProblemStatus,
    RiskLevel,
    Role,
    Scenario,
    TaskActivityType,
    TaskLevel,
    UserStatus,
)


LEVEL_REWARD_RANGE = {
    TaskLevel.S: (8000.0, 15000.0),
    TaskLevel.A: (3000.0, 8000.0),
    TaskLevel.B: (1000.0, 3000.0),
    TaskLevel.C: (200.0, 1000.0),
}

LEVEL_POINTS_RANGE = {
    TaskLevel.S: (80, 150),
    TaskLevel.A: (40, 80),
    TaskLevel.B: (15, 40),
    TaskLevel.C: (5, 15),
}


class UserCreate(BaseModel):
    name: str = Field(min_length=1)
    employee_no: Optional[str] = None
    department: Optional[str] = None
    email: Optional[str] = None
    roles: list[Role] = Field(default_factory=lambda: [Role.EMPLOYEE])


class RoleUpdate(BaseModel):
    roles: list[Role]


class UserStatusUpdate(BaseModel):
    status: UserStatus


class UserRead(BaseModel):
    id: int
    name: str
    employee_no: Optional[str]
    department: Optional[str]
    email: Optional[str]
    status: str
    overdue_count: int
    roles: list[Role]
    has_password: bool = False


class AdminLoginRequest(BaseModel):
    """管理员账号密码登录"""
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=6, max_length=100)


class ChangePasswordRequest(BaseModel):
    """修改密码"""
    old_password: str = Field(min_length=6, max_length=100)
    new_password: str = Field(min_length=8, max_length=100)
    
    @model_validator(mode="after")
    def validate_password_strength(self) -> "ChangePasswordRequest":
        """验证密码强度"""
        password = self.new_password
        
        # 至少8位
        if len(password) < 8:
            raise ValueError("密码至少需要8位")
        
        # 包含大小写字母、数字、特殊字符
        has_upper = any(c.isupper() for c in password)
        has_lower = any(c.islower() for c in password)
        has_digit = any(c.isdigit() for c in password)
        has_special = any(c in "!@#$%^&*()_+-=[]{}|;:,.<>?" for c in password)
        
        strength_count = sum([has_upper, has_lower, has_digit, has_special])
        if strength_count < 3:
            raise ValueError("密码必须包含大小写字母、数字、特殊字符中的至少3种")
        
        # 不能与旧密码相同
        if self.old_password == self.new_password:
            raise ValueError("新密码不能与旧密码相同")
        
        return self


class SetPasswordRequest(BaseModel):
    """管理员为用户设置密码"""
    new_password: str = Field(min_length=8, max_length=100)
    force_change: bool = Field(default=True, description="是否强制用户下次登录修改密码")


class AuthLoginResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    user: UserRead


class ProblemCreate(BaseModel):
    title: str = Field(min_length=1, max_length=50)
    scenario: Scenario
    background: str
    frequency: ProblemFrequency
    impact_scope: str
    description: str
    value_reduce_effort: bool = False
    value_reduce_cost: bool = False
    value_improve_quality: bool = False
    value_statement: str
    current_solution: Optional[str] = None
    task_draft: Optional["TaskDraftDefinition"] = None
    attachment_urls: list[str] = Field(default_factory=list)
    attachment_ids: list[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_value_flags(self) -> "ProblemCreate":
        if not (self.value_reduce_effort or self.value_reduce_cost or self.value_improve_quality):
            raise ValueError("价值假设至少选择一项")
        return self


class ProblemRead(BaseModel):
    id: int
    title: str
    scenario: Scenario
    status: ProblemStatus
    reject_reason: Optional[str] = None
    merged_problem_id: Optional[int] = None
    analysis_status: AnalysisStatus = AnalysisStatus.PENDING
    reviewer_comment: Optional[str] = None
    submitter_id: int
    submitter_name: str
    created_at: datetime


class ProblemDetailRead(BaseModel):
    id: int
    title: str
    scenario: Scenario
    background: str
    frequency: ProblemFrequency
    impact_scope: str
    description: str
    value_reduce_effort: bool
    value_reduce_cost: bool
    value_improve_quality: bool
    value_statement: str
    current_solution: Optional[str]
    attachment_urls: list[str] = Field(default_factory=list)
    status: ProblemStatus
    reject_reason: Optional[str] = None
    merged_problem_id: Optional[int] = None
    draft_goal: Optional[str] = None
    draft_scope: Optional[str] = None
    draft_due_date: Optional[date] = None
    draft_acceptance_criteria: list[dict] = Field(default_factory=list)
    submitter_reflection: Optional[str] = None
    reviewer_comment: Optional[str] = None
    priced_level: Optional[TaskLevel] = None
    priced_reward_total: Optional[float] = None
    priced_proposer_ratio: Optional[float] = None
    priced_accepter_id: Optional[int] = None
    priced_points: int = 0
    priced_badge: Optional[str] = None
    priced_is_complex: bool = False
    priced_closing_reward_ratio: float = 1.0
    priced_milestones: list[dict] = Field(default_factory=list)
    analysis_status: AnalysisStatus = AnalysisStatus.PENDING
    submitter_id: int
    submitter_name: str
    created_at: datetime


class AcceptanceCriteriaItem(BaseModel):
    description: str
    type: str = Field(pattern="^(quantified|behavioral)$")


class TaskDraftDefinition(BaseModel):
    goal: str = Field(min_length=1)
    scope: str = Field(min_length=1)
    due_date: date
    acceptance_criteria: list[AcceptanceCriteriaItem] = Field(min_length=1)
    self_reflection: str = Field(min_length=1)


class TaskDefinition(BaseModel):
    title: str
    goal: str
    scope: str
    due_date: date
    level: TaskLevel
    reward_total: float
    proposer_ratio: float = Field(ge=0.2, le=0.3)
    accepter_id: int
    points: int = 0
    badge: Optional[str] = None
    is_complex: bool = False
    closing_reward_ratio: float = Field(default=0.4, gt=0, lt=1)
    milestones: list["TaskMilestoneDefinition"] = Field(default_factory=list)
    acceptance_criteria: list[AcceptanceCriteriaItem] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_reward_range(self) -> "TaskDefinition":
        low, high = LEVEL_REWARD_RANGE[self.level]
        if not (low <= self.reward_total <= high):
            raise ValueError(f"{self.level} 等级激励范围应在 {low}-{high}")
        points_low, points_high = LEVEL_POINTS_RANGE[self.level]
        if self.points == 0:
            self.points = points_low
        if not (points_low <= self.points <= points_high):
            raise ValueError(f"{self.level} 等级积分范围应在 {points_low}-{points_high}")
        if self.badge and not is_valid_badge_code(self.badge):
            raise ValueError("invalid badge code")
        if not self.is_complex and self.milestones:
            raise ValueError("simple tasks do not support milestones")
        if self.is_complex:
            if not (2 <= len(self.milestones) <= 5):
                raise ValueError("complex tasks must define 2-5 milestones")
            ordered = sorted(self.milestones, key=lambda item: item.sequence)
            for index, item in enumerate(ordered, start=1):
                if item.sequence != index:
                    raise ValueError("milestone sequence must start at 1 and be continuous")
                if not item.acceptance_criteria:
                    raise ValueError("milestone acceptance criteria is required")
            milestone_ratio_sum = sum(item.reward_ratio for item in self.milestones)
            if abs((milestone_ratio_sum + self.closing_reward_ratio) - 1.0) > 1e-6:
                raise ValueError("milestone ratios plus closing ratio must equal 1")
        return self


class TaskMilestoneDefinition(BaseModel):
    sequence: int = Field(ge=1)
    title: str = Field(min_length=1)
    goal: str = Field(min_length=1)
    due_date: Optional[date] = None
    acceptance_criteria: list[AcceptanceCriteriaItem] = Field(min_length=1)
    reward_ratio: float = Field(gt=0, lt=1)


class PricingDefinition(BaseModel):
    level: TaskLevel
    reward_total: float
    proposer_ratio: float = Field(ge=0.2, le=0.3)
    accepter_id: int
    points: int = 0
    badge: Optional[str] = None

    @model_validator(mode="after")
    def validate_reward_range(self) -> "PricingDefinition":
        low, high = LEVEL_REWARD_RANGE[self.level]
        if not (low <= self.reward_total <= high):
            raise ValueError(f"{self.level} reward range must be {low}-{high}")
        points_low, points_high = LEVEL_POINTS_RANGE[self.level]
        if self.points == 0:
            self.points = points_low
        if not (points_low <= self.points <= points_high):
            raise ValueError(f"{self.level} points range must be {points_low}-{points_high}")
        if self.badge and not is_valid_badge_code(self.badge):
            raise ValueError("invalid badge code")
        return self


class ProblemReview(BaseModel):
    approve: bool
    final_reject: bool = False
    review_comment: Optional[str] = None
    reject_reason: Optional[str] = None
    merge_to_problem_id: Optional[int] = None
    pricing: Optional[PricingDefinition] = None
    task: Optional[TaskDefinition] = None
    analysis_id: Optional[int] = None
    analysis_acceptance: Optional[str] = None

    @model_validator(mode="after")
    def validate_payload(self) -> "ProblemReview":
        if self.approve:
            if self.pricing is None and self.task is None:
                raise ValueError("pricing or task payload is required when approve=true")
            if self.analysis_id is not None and not self.analysis_acceptance:
                raise ValueError("analysis_acceptance is required when analysis_id is provided")
        if not self.approve and not (self.review_comment or self.reject_reason):
            raise ValueError("review_comment is required when approve=false")
        return self


class TaskRead(BaseModel):
    id: int
    problem_id: int
    title: str
    scenario: Scenario
    level: TaskLevel
    reward_total: float
    is_complex: bool = False
    active_claim_count: int = 0
    due_date: date
    status: str
    created_at: datetime


class ProblemReviewResult(BaseModel):
    status: ProblemStatus
    task: Optional[TaskRead] = None
    message: Optional[str] = None
    # backward-compatible flat task fields
    id: Optional[int] = None
    problem_id: Optional[int] = None
    title: Optional[str] = None
    scenario: Optional[Scenario] = None
    level: Optional[TaskLevel] = None
    reward_total: Optional[float] = None
    active_claim_count: Optional[int] = None
    due_date: Optional[date] = None
    created_at: Optional[datetime] = None


class ProblemSubmitResult(BaseModel):
    id: int
    status: ProblemStatus


class ProblemBudgetReview(BaseModel):
    approve: bool
    comment: Optional[str] = None


class TaskDetailRead(BaseModel):
    id: int
    problem_id: int
    title: str
    goal: str
    scope: str
    due_date: date
    level: TaskLevel
    reward_total: float
    proposer_ratio: float
    accepter_id: int
    points: int
    badge: Optional[str]
    is_complex: bool = False
    closing_reward_ratio: float = 1.0
    acceptance_criteria: list[dict]
    status: str
    created_at: datetime


class TaskActivityCreate(BaseModel):
    claim_id: Optional[int] = None
    activity_type: TaskActivityType
    content: str = Field(min_length=1)
    detail: dict = Field(default_factory=dict)
    attachment_ids: list[int] = Field(default_factory=list)

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("content must not be blank")
        return cleaned


class TaskActivityRead(BaseModel):
    id: int
    task_id: int
    claim_id: Optional[int] = None
    activity_type: TaskActivityType
    actor_user_id: int
    content: str
    detail: dict = Field(default_factory=dict)
    attachment_urls: list[str] = Field(default_factory=list)
    created_at: datetime


class TaskMilestoneCreate(BaseModel):
    sequence: int = Field(ge=1)
    title: str = Field(min_length=1)
    goal: str = Field(min_length=1)
    due_date: Optional[date] = None
    acceptance_criteria: list[AcceptanceCriteriaItem] = Field(min_length=1)
    reward_ratio: float = Field(gt=0, lt=1)


class TaskMilestoneUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1)
    goal: Optional[str] = Field(default=None, min_length=1)
    due_date: Optional[date] = None
    acceptance_criteria: Optional[list[AcceptanceCriteriaItem]] = None
    reward_ratio: Optional[float] = Field(default=None, gt=0, lt=1)
    status: Optional[MilestoneStatus] = None


class MilestoneSubmissionCreate(BaseModel):
    claim_id: Optional[int] = None
    summary: str = Field(min_length=1)
    evidence_urls: list[str] = Field(default_factory=list)
    evidence_attachment_ids: list[int] = Field(default_factory=list)
    criteria_results: list[str] = Field(default_factory=list)


class MilestoneAcceptanceCreate(BaseModel):
    result: MilestoneAcceptanceResult
    comment: Optional[str] = None


class MilestoneSubmissionRead(BaseModel):
    id: int
    milestone_id: int
    claim_id: int
    summary: str
    evidence_urls: list[str] = Field(default_factory=list)
    criteria_results: list[str] = Field(default_factory=list)
    submitted_by_user_id: int
    submitted_at: datetime


class TaskMilestoneRead(BaseModel):
    id: int
    task_id: int
    sequence: int
    title: str
    goal: str
    due_date: Optional[date] = None
    acceptance_criteria: list[dict] = Field(default_factory=list)
    reward_ratio: float
    status: MilestoneStatus
    latest_submission: Optional[MilestoneSubmissionRead] = None
    created_at: datetime
    updated_at: datetime


class MilestonePendingAcceptanceRead(BaseModel):
    milestone_id: int
    task_id: int
    task_title: str
    sequence: int
    claim_id: int
    submitted_at: datetime
    submitted_by_user_id: int
    status: MilestoneStatus


class MilestoneRewardHoldRead(BaseModel):
    id: int
    task_id: int
    milestone_id: int
    claim_id: int
    user_id: int
    ratio: float
    amount: float
    status: MilestoneRewardHoldStatus
    created_at: datetime
    released_at: Optional[datetime] = None


class ClaimMemberInput(BaseModel):
    user_id: int
    ratio: float = Field(gt=0, le=1)


class ClaimCreate(BaseModel):
    mode: ClaimMode
    lead_user_id: Optional[int] = None
    members: list[ClaimMemberInput] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_mode(self) -> "ClaimCreate":
        if self.mode == ClaimMode.TEAM:
            if len(self.members) < 2:
                raise ValueError("联合揭榜至少需要两位成员")
            total_ratio = sum(item.ratio for item in self.members)
            if abs(total_ratio - 1.0) > 1e-6:
                raise ValueError("联合揭榜成员比例总和必须等于 1")
        return self


class ClaimRead(BaseModel):
    id: int
    task_id: int
    lead_user_id: int
    mode: ClaimMode
    status: str
    created_at: datetime


class ClaimApprovalRequestRead(BaseModel):
    id: int
    task_id: int
    task_title: str
    applicant_user_id: int
    applicant_user_name: str
    applicant_overdue_count: int
    status: str
    reason: Optional[str]
    reviewed_by_user_id: Optional[int]
    reviewed_at: Optional[datetime]
    created_at: datetime


class ClaimApprovalReviewInput(BaseModel):
    comment: Optional[str] = None


class DeliverableCreate(BaseModel):
    summary: str
    evidence_urls: list[str] = Field(default_factory=list)
    evidence_attachment_ids: list[int] = Field(default_factory=list)
    criteria_results: list[str] = Field(default_factory=list)


class DeliverableRead(BaseModel):
    id: int
    claim_id: int
    status: str
    submitted_at: datetime


class AcceptanceCreate(BaseModel):
    result: AcceptanceResult
    comment: Optional[str] = None


class RewardRead(BaseModel):
    id: int
    task_id: int
    task_title: Optional[str] = None
    user_id: int
    user_name: Optional[str] = None
    role_type: str
    amount: float
    points: int
    badge: Optional[str]
    status: str
    confirmed_at: Optional[datetime]


class BadgeDefinitionRead(BaseModel):
    code: str
    name: str
    category: str
    description: str
    icon: str
    auto_enabled: bool


class UserBadgeRead(BadgeDefinitionRead):
    source_type: str
    source_id: Optional[int] = None
    earned_at: datetime


class PersonalRewardStats(BaseModel):
    total_records: int
    confirmed_records: int
    confirmed_reward_amount: float
    total_points: int
    confirmed_points: int


class PersonalSummaryRead(BaseModel):
    user: UserRead
    stats: PersonalRewardStats
    badges: list[str]
    badge_details: list[UserBadgeRead] = Field(default_factory=list)
    rewards: list[RewardRead]


class DashboardOverview(BaseModel):
    problem_total: int
    problem_approved: int
    task_total: int
    task_completed: int
    task_overdue_claims: int
    task_completion_rate: float
    task_overdue_rate: float
    reward_total_confirmed_amount: float


TimeRange = Literal["this_month", "this_quarter", "this_year", "all"]
TrendGranularity = Literal["week", "month"]


class RankingItem(BaseModel):
    user_id: int
    user_name: str
    value: float


class DashboardRankings(BaseModel):
    claim_count_ranking: list[RankingItem]
    reward_amount_ranking: list[RankingItem]
    problem_contribution_ranking: list[RankingItem]
    points_ranking: list[RankingItem]


class TrendPoint(BaseModel):
    period: str
    problem_submitted: int
    task_completed: int
    reward_confirmed_amount: float


class DashboardTrends(BaseModel):
    granularity: TrendGranularity
    points: list[TrendPoint]


class DistributionItem(BaseModel):
    name: str
    count: int


class DashboardDistribution(BaseModel):
    scenario_distribution: list[DistributionItem]
    level_distribution: list[DistributionItem]
    department_distribution: list[DistributionItem]


class FeishuLoginUrlResponse(BaseModel):
    provider: str
    state: str
    login_url: str
    expires_at: datetime


class FeishuLoginResult(BaseModel):
    user_id: int
    user_name: str
    external_id: str
    is_new_user: bool
    access_token: Optional[str] = None
    token_type: Optional[str] = None
    expires_in: Optional[int] = None


class SyncFrequencyConfig(BaseModel):
    frequency_minutes: int = Field(ge=5, le=10080)


class ClaimApprovalThresholdConfig(BaseModel):
    threshold: int = Field(ge=1, le=100)


class BudgetReviewThresholdConfig(BaseModel):
    threshold: float = Field(ge=0, le=1000000)


class SystemConfigOverviewRead(BaseModel):
    feishu_sync_frequency_minutes: int
    release_overdue_frequency_minutes: int
    claim_approval_overdue_threshold: int
    budget_review_threshold: float
    acceptance_templates: "AcceptanceTemplatesConfig"


class SystemVersionRead(BaseModel):
    backend_version: str
    backend_git_sha: str


class AcceptanceTemplatesConfig(BaseModel):
    approved: list[str] = Field(min_length=1)
    rework: list[str] = Field(min_length=1)
    rejected: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_templates(self) -> "AcceptanceTemplatesConfig":
        groups = {
            "approved": self.approved,
            "rework": self.rework,
            "rejected": self.rejected,
        }
        for key, values in groups.items():
            cleaned = [item.strip() for item in values if item and item.strip()]
            if not cleaned:
                raise ValueError(f"{key} template list must include at least one non-empty item")
            if any(len(item) > 200 for item in cleaned):
                raise ValueError(f"{key} template item must not exceed 200 chars")
            setattr(self, key, cleaned)
        return self


class DepartmentRead(BaseModel):
    id: int
    external_id: str
    name: str
    parent_external_id: Optional[str]
    leader_external_user_id: Optional[str]
    updated_at: datetime


class FeishuSyncResult(BaseModel):
    synced_departments: int = 0
    synced_users: int = 0
    mode: str


class AttachmentRead(BaseModel):
    id: int
    filename: str
    content_type: str
    size_bytes: int
    checksum_sha256: str
    storage_backend: str
    bucket: Optional[str]
    uploader_user_id: int
    entity_type: Optional[str]
    entity_id: Optional[int]
    download_url: str
    created_at: datetime


class AttachmentPresignRead(BaseModel):
    attachment_id: int
    url: str
    expires_in: int


class ClaimExecutionRead(BaseModel):
    claim_id: int
    claim_status: str
    claim_mode: str
    task_id: int
    task_title: str
    task_status: str
    due_date: date
    deliverable_id: Optional[int] = None
    deliverable_status: Optional[str] = None
    deliverable_submitted_at: Optional[datetime] = None


class PendingAcceptanceRead(BaseModel):
    deliverable_id: int
    claim_id: int
    task_id: int
    task_title: str
    lead_user_id: int
    submitted_at: datetime
    deliverable_status: str


class AcceptanceHistoryItem(BaseModel):
    acceptance_id: int
    accepter_id: int
    result: str
    comment: Optional[str]
    created_at: datetime


class ClaimExecutionDetailRead(BaseModel):
    claim_id: int
    claim_status: str
    claim_mode: str
    lead_user_id: int
    task_id: int
    task_title: str
    task_goal: str
    task_scope: str
    task_status: str
    due_date: date
    acceptance_criteria: list[dict]
    deliverable_id: Optional[int] = None
    deliverable_status: Optional[str] = None
    deliverable_summary: Optional[str] = None
    evidence_urls: list[str] = Field(default_factory=list)
    criteria_results: list[str] = Field(default_factory=list)
    submitted_at: Optional[datetime] = None
    acceptance_history: list[AcceptanceHistoryItem] = Field(default_factory=list)



class OperationLogRead(BaseModel):
    id: int
    actor_user_id: Optional[int]
    action: str
    target_type: str
    target_id: Optional[int]
    detail: dict
    created_at: datetime



class AIModelCreate(BaseModel):
    name: str
    provider: AIProvider
    api_base_url: str
    api_key: str
    model: str
    is_default: bool = False
    enabled: bool = True
    max_tokens: int = 4096
    temperature: float = 0.7
    timeout: int = 60


class AIModelUpdate(BaseModel):
    name: Optional[str] = None
    api_base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    is_default: Optional[bool] = None
    enabled: Optional[bool] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    timeout: Optional[int] = None


class AIModelRead(BaseModel):
    id: int
    name: str
    provider: AIProvider
    api_base_url: str
    has_api_key: bool
    model: str
    is_default: bool
    enabled: bool
    max_tokens: int
    temperature: float
    timeout: int
    created_at: datetime
    updated_at: datetime


class HypothesisItem(BaseModel):
    content: str
    hypothesis_type: HypothesisType
    risk_level: RiskLevel
    verification_method: str


class ProblemAnalysisCreate(BaseModel):
    problem_id: int


class ProblemAnalysisRead(BaseModel):
    id: int
    problem_id: int
    ai_model_id: int
    status: AnalysisStatus

    core_problem: Optional[str]
    target_users: list[str]
    problem_boundaries: Optional[str]
    success_criteria: Optional[str]

    assumptions_challenged: list[dict]
    risks_identified: list[dict]
    alternative_views: list[str]

    user_questions: list[str]
    user_value_priorities: list[str]
    edge_cases: list[str]

    hypothesis_list: list[HypothesisItem]
    falsification_checks: list[str]
    mvp_boundaries: Optional[str]
    next_actions: list[str]

    recommendation: Optional[str]
    confidence: Optional[float]

    rounds: int
    error_message: Optional[str]

    created_at: datetime
    updated_at: datetime


class HypothesisVerificationUpdate(BaseModel):
    verification_status: HypothesisStatus
    verification_method: Optional[str] = None
    verification_result: Optional[str] = None


class HypothesisVerificationRead(BaseModel):
    id: int
    analysis_id: int
    hypothesis_content: str
    hypothesis_type: HypothesisType
    risk_level: RiskLevel
    verification_status: HypothesisStatus
    verification_method: Optional[str]
    verification_result: Optional[str]
    verified_by: Optional[int]
    verified_at: Optional[datetime]
    created_at: datetime


class ProblemReviewAnalysisRefCreate(BaseModel):
    recommendation: str
    analysis_id: int
    acceptance_reason: Optional[str] = None
    rejection_reason: Optional[str] = None


class ProblemReviewAnalysisRefRead(BaseModel):
    id: int
    problem_id: int
    recommendation: str
    analysis_id: int
    acceptance_reason: Optional[str]
    rejection_reason: Optional[str]
    reviewed_by: int
    created_at: datetime


class ProblemDetailWithAnalysisRead(ProblemDetailRead):
    analysis_id: Optional[int] = None
    analysis_status: AnalysisStatus = AnalysisStatus.PENDING
    analysis: Optional[ProblemAnalysisRead] = None
    analysis_ref: Optional[ProblemReviewAnalysisRefRead] = None
