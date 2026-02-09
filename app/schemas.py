from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from app.enums import (
    AcceptanceResult,
    ClaimMode,
    ProblemFrequency,
    ProblemStatus,
    Role,
    Scenario,
    TaskLevel,
    UserStatus,
)


LEVEL_REWARD_RANGE = {
    TaskLevel.S: (8000.0, 15000.0),
    TaskLevel.A: (3000.0, 8000.0),
    TaskLevel.B: (1000.0, 3000.0),
    TaskLevel.C: (200.0, 1000.0),
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
    submitter_id: int
    created_at: datetime


class AcceptanceCriteriaItem(BaseModel):
    description: str
    type: str = Field(pattern="^(quantified|behavioral)$")


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
    acceptance_criteria: list[AcceptanceCriteriaItem] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_reward_range(self) -> "TaskDefinition":
        low, high = LEVEL_REWARD_RANGE[self.level]
        if not (low <= self.reward_total <= high):
            raise ValueError(f"{self.level} 等级激励范围应在 {low}-{high}")
        return self


class ProblemReview(BaseModel):
    approve: bool
    reject_reason: Optional[str] = None
    merge_to_problem_id: Optional[int] = None
    task: Optional[TaskDefinition] = None

    @model_validator(mode="after")
    def validate_payload(self) -> "ProblemReview":
        if self.approve and self.task is None:
            raise ValueError("立项时必须提供任务定义")
        if not self.approve and not self.reject_reason:
            raise ValueError("不立项时必须填写原因")
        return self


class TaskRead(BaseModel):
    id: int
    problem_id: int
    title: str
    scenario: Scenario
    level: TaskLevel
    reward_total: float
    active_claim_count: int = 0
    due_date: date
    status: str
    created_at: datetime


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
    acceptance_criteria: list[dict]
    status: str
    created_at: datetime


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
    user_id: int
    role_type: str
    amount: float
    points: int
    badge: Optional[str]
    status: str
    confirmed_at: Optional[datetime]


class DashboardOverview(BaseModel):
    problem_total: int
    problem_approved: int
    task_total: int
    task_completed: int
    task_overdue_claims: int
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


class SyncFrequencyConfig(BaseModel):
    frequency_minutes: int = Field(ge=5, le=10080)


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
