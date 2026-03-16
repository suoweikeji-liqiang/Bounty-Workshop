from __future__ import annotations

from datetime import datetime, date
from typing import Optional

from sqlalchemy import Index, UniqueConstraint, text
from sqlmodel import Field, SQLModel

from app.enums import (
    AIProvider,
    AnalysisStatus,
    ClaimApprovalStatus,
    ClaimMode,
    ClaimStatus,
    DeliverableStatus,
    HypothesisStatus,
    HypothesisType,
    MilestoneAcceptanceResult,
    MilestoneRewardHoldStatus,
    MilestoneStatus,
    ProblemFrequency,
    ProblemStatus,
    RewardRoleType,
    RewardStatus,
    RiskLevel,
    Role,
    Scenario,
    TaskActivityType,
    TaskLevel,
    TaskStatus,
    TaskType,
    UserStatus,
)


class UserRole(SQLModel, table=True):
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", primary_key=True)
    role: Role = Field(primary_key=True)


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    external_id: Optional[str] = Field(default=None, index=True)
    employee_no: Optional[str] = Field(default=None, index=True)
    name: str
    department: Optional[str] = None
    email: Optional[str] = None
    avatar_url: Optional[str] = None
    password_hash: Optional[str] = None  # 管理员密码哈希
    password_changed_at: Optional[datetime] = None  # 密码修改时间
    force_password_change: bool = Field(default=False)  # 强制修改密码
    failed_login_attempts: int = Field(default=0)  # 登录失败次数
    locked_until: Optional[datetime] = None  # 账号锁定至
    status: UserStatus = Field(default=UserStatus.ENABLED)
    overdue_count: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Problem(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str = Field(index=True, max_length=50)
    scenario: Scenario = Field(index=True)
    background: str
    frequency: ProblemFrequency
    impact_scope: str
    description: str
    value_reduce_effort: bool = Field(default=False)
    value_reduce_cost: bool = Field(default=False)
    value_improve_quality: bool = Field(default=False)
    value_statement: str
    current_solution: Optional[str] = None
    attachment_urls: str = Field(default="[]")
    draft_goal: Optional[str] = None
    draft_scope: Optional[str] = None
    draft_due_date: Optional[date] = Field(default=None, index=True)
    draft_acceptance_criteria_json: str = Field(default="[]")
    submitter_reflection: Optional[str] = None
    submitter_id: int = Field(foreign_key="user.id", index=True)
    status: ProblemStatus = Field(default=ProblemStatus.DRAFT, index=True)
    reject_reason: Optional[str] = None
    merged_problem_id: Optional[int] = Field(default=None, foreign_key="problem.id")
    reviewer_comment: Optional[str] = None
    priced_level: Optional[TaskLevel] = None
    priced_reward_total: Optional[float] = None
    priced_proposer_ratio: Optional[float] = None
    priced_accepter_id: Optional[int] = Field(default=None, foreign_key="user.id")
    priced_points: int = Field(default=0)
    priced_badge: Optional[str] = None
    priced_task_type: TaskType = Field(default=TaskType.NORMAL)
    priced_is_complex: bool = Field(default=False)
    priced_closing_reward_ratio: float = Field(default=1.0)
    priced_milestones_json: str = Field(default="[]")
    priced_by_user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    budget_review_comment: Optional[str] = None
    budget_reviewed_by_user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    budget_reviewed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    analysis_id: Optional[int] = Field(default=None)
    analysis_status: AnalysisStatus = Field(default=AnalysisStatus.PENDING)


class Task(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    problem_id: int = Field(foreign_key="problem.id", index=True)
    title: str
    goal: str
    scope: str
    due_date: date = Field(index=True)
    level: TaskLevel
    reward_total: float
    proposer_ratio: float
    accepter_id: int = Field(foreign_key="user.id", index=True)
    points: int = Field(default=0)
    badge: Optional[str] = None
    task_type: TaskType = Field(default=TaskType.NORMAL, index=True)
    is_complex: bool = Field(default=False, index=True)
    closing_reward_ratio: float = Field(default=1.0)
    acceptance_criteria_json: str = Field(default="[]")
    status: TaskStatus = Field(default=TaskStatus.OPEN, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Claim(SQLModel, table=True):
    __table_args__ = (
        Index(
            "uq_claim_task_lead_active",
            "task_id",
            "lead_user_id",
            unique=True,
            sqlite_where=text("status = 'active'"),
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="task.id", index=True)
    lead_user_id: int = Field(foreign_key="user.id", index=True)
    mode: ClaimMode
    status: ClaimStatus = Field(default=ClaimStatus.ACTIVE, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ClaimApprovalRequest(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="task.id", index=True)
    applicant_user_id: int = Field(foreign_key="user.id", index=True)
    status: ClaimApprovalStatus = Field(default=ClaimApprovalStatus.PENDING, index=True)
    reason: Optional[str] = None
    reviewed_by_user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    reviewed_at: Optional[datetime] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class ClaimMember(SQLModel, table=True):
    claim_id: Optional[int] = Field(default=None, foreign_key="claim.id", primary_key=True)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", primary_key=True)
    ratio: float


class Deliverable(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    claim_id: int = Field(foreign_key="claim.id", index=True, unique=True)
    summary: str
    evidence_urls: str = Field(default="[]")
    criteria_results_json: str = Field(default="[]")
    rework_count: int = Field(default=0)
    status: DeliverableStatus = Field(default=DeliverableStatus.SUBMITTED, index=True)
    submitted_at: datetime = Field(default_factory=datetime.utcnow)


class Acceptance(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    deliverable_id: int = Field(foreign_key="deliverable.id", index=True)
    accepter_id: int = Field(foreign_key="user.id", index=True)
    result: str
    comment: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)



class TaskActivity(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="task.id", index=True)
    claim_id: Optional[int] = Field(default=None, foreign_key="claim.id", index=True)
    activity_type: TaskActivityType = Field(index=True)
    actor_user_id: int = Field(foreign_key="user.id", index=True)
    content: str
    detail_json: str = Field(default="{}")
    attachment_urls: str = Field(default="[]")
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class TaskMilestone(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="task.id", index=True)
    sequence: int = Field(index=True)
    title: str
    goal: str
    due_date: Optional[date] = Field(default=None, index=True)
    acceptance_criteria_json: str = Field(default="[]")
    reward_ratio: float
    status: MilestoneStatus = Field(default=MilestoneStatus.PENDING, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class MilestoneSubmission(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    milestone_id: int = Field(foreign_key="taskmilestone.id", index=True)
    claim_id: int = Field(foreign_key="claim.id", index=True)
    summary: str
    evidence_urls: str = Field(default="[]")
    criteria_results_json: str = Field(default="[]")
    submitted_by_user_id: int = Field(foreign_key="user.id", index=True)
    submitted_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class MilestoneAcceptance(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    milestone_id: int = Field(foreign_key="taskmilestone.id", index=True)
    submission_id: int = Field(foreign_key="milestonesubmission.id", index=True)
    accepter_id: int = Field(foreign_key="user.id", index=True)
    result: MilestoneAcceptanceResult
    comment: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class MilestoneRewardHold(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="task.id", index=True)
    milestone_id: int = Field(foreign_key="taskmilestone.id", index=True)
    claim_id: int = Field(foreign_key="claim.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    ratio: float
    amount: float
    status: MilestoneRewardHoldStatus = Field(default=MilestoneRewardHoldStatus.EARNED, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    released_at: Optional[datetime] = Field(default=None, index=True)


class Reward(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="task.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    role_type: RewardRoleType
    amount: float
    points: int = Field(default=0)
    badge: Optional[str] = None
    status: RewardStatus = Field(default=RewardStatus.GENERATED, index=True)
    confirmed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class UserBadge(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("user_id", "badge_code", name="uq_user_badge"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    badge_code: str = Field(index=True)
    source_type: str
    source_id: Optional[int] = None
    earned_at: datetime = Field(default_factory=datetime.utcnow)


class Knowledge(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="task.id", unique=True, index=True)
    problem_summary: str
    solution_summary: str
    tags: str = Field(default="[]")
    recommended: bool = Field(default=False, index=True)
    archived_at: datetime = Field(default_factory=datetime.utcnow)


class OperationLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    actor_user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    action: str = Field(index=True)
    target_type: str
    target_id: Optional[int] = None
    detail: str = Field(default="{}")
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class Department(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    external_id: str = Field(unique=True, index=True)
    name: str
    parent_external_id: Optional[str] = Field(default=None, index=True)
    leader_external_user_id: Optional[str] = None
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class OAuthState(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    provider: str = Field(index=True)
    state: str = Field(unique=True, index=True)
    expires_at: datetime = Field(index=True)
    consumed_at: Optional[datetime] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class SystemConfig(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class Attachment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    object_key: str = Field(unique=True, index=True)
    filename: str
    content_type: str
    size_bytes: int
    checksum_sha256: str = Field(index=True)
    storage_backend: str = Field(default="local")
    bucket: Optional[str] = Field(default=None)
    uploader_user_id: int = Field(foreign_key="user.id", index=True)
    entity_type: Optional[str] = Field(default=None, index=True)
    entity_id: Optional[int] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class AIModel(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    provider: AIProvider
    api_base_url: str
    api_key_encrypted: Optional[str] = None
    model: str
    is_default: bool = Field(default=False)
    enabled: bool = Field(default=True)
    max_tokens: int = Field(default=4096)
    temperature: float = Field(default=0.7)
    timeout: int = Field(default=60)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ProblemAnalysis(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    problem_id: int = Field(foreign_key="problem.id", index=True)
    ai_model_id: int

    input_json: str

    core_problem: Optional[str] = None
    target_users: str = Field(default="[]")
    problem_boundaries: Optional[str] = None
    success_criteria: Optional[str] = None

    assumptions_challenged: str = Field(default="[]")
    risks_identified: str = Field(default="[]")
    alternative_views: str = Field(default="[]")

    user_questions: str = Field(default="[]")
    user_value_priorities: str = Field(default="[]")
    edge_cases: str = Field(default="[]")

    hypothesis_list: str = Field(default="[]")
    falsification_checks: str = Field(default="[]")
    mvp_boundaries: Optional[str] = None
    next_actions: str = Field(default="[]")

    recommendation: Optional[str] = None
    confidence: Optional[float] = None

    rounds: int = Field(default=1)
    status: AnalysisStatus = Field(default=AnalysisStatus.PENDING)
    error_message: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class HypothesisVerification(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    analysis_id: int

    hypothesis_content: str
    hypothesis_type: HypothesisType
    risk_level: RiskLevel

    verification_status: HypothesisStatus = Field(default=HypothesisStatus.PENDING)
    verification_method: Optional[str] = None
    verification_result: Optional[str] = None

    verified_by: Optional[int] = Field(default=None)
    verified_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ProblemReviewAnalysisRef(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    problem_id: int

    recommendation: str
    analysis_id: int
    acceptance_reason: Optional[str] = None
    rejection_reason: Optional[str] = None

    reviewed_by: int
    created_at: datetime = Field(default_factory=datetime.utcnow)
