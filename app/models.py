from __future__ import annotations

from datetime import datetime, date
from typing import Optional

from sqlmodel import Field, SQLModel

from app.enums import (
    BaselineResponsibilityStatus,
    ClaimApprovalStatus,
    ClaimMode,
    ClaimStatus,
    DeliverableStatus,
    IncidentSeverity,
    PerformanceLevel,
    ProblemFrequency,
    ProblemStatus,
    RewardRoleType,
    RewardStatus,
    Role,
    Scenario,
    TaskLevel,
    TaskStatus,
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
    submitter_id: int = Field(foreign_key="user.id", index=True)
    status: ProblemStatus = Field(default=ProblemStatus.PENDING_REVIEW, index=True)
    reject_reason: Optional[str] = None
    merged_problem_id: Optional[int] = Field(default=None, foreign_key="problem.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)


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
    acceptance_criteria_json: str = Field(default="[]")
    status: TaskStatus = Field(default=TaskStatus.OPEN, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Claim(SQLModel, table=True):
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
    status: DeliverableStatus = Field(default=DeliverableStatus.SUBMITTED, index=True)
    submitted_at: datetime = Field(default_factory=datetime.utcnow)


class Acceptance(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    deliverable_id: int = Field(foreign_key="deliverable.id", index=True)
    accepter_id: int = Field(foreign_key="user.id", index=True)
    result: str
    comment: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PerformanceReviewSnapshot(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    claim_id: int = Field(foreign_key="claim.id", index=True, unique=True)
    task_id: int = Field(foreign_key="task.id", index=True)
    deliverable_id: Optional[int] = Field(default=None, foreign_key="deliverable.id", index=True)
    reviewed_by_user_id: int = Field(foreign_key="user.id", index=True)
    baseline_responsibility_status: BaselineResponsibilityStatus = Field(
        default=BaselineResponsibilityStatus.GOOD,
        index=True,
    )
    baseline_reasons: str = Field(default="[]")
    incident_severity: IncidentSeverity = Field(default=IncidentSeverity.NONE)
    incident_count: int = Field(default=0)
    missed_deadline_count: int = Field(default=0)
    unjustified_delay_count: int = Field(default=0)
    process_violation_count: int = Field(default=0)
    known_risk_unreported: bool = Field(default=False)
    repeated_issue_count: int = Field(default=0)
    critical_task_missed_without_reason: bool = Field(default=False)
    repeated_issue_without_improvement: bool = Field(default=False)
    has_t3_plus_task: bool = Field(default=False)
    initial_r_level: PerformanceLevel = Field(default=PerformanceLevel.R3)
    final_r_level: PerformanceLevel = Field(default=PerformanceLevel.R3)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)


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
