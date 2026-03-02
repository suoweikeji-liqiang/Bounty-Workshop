from enum import Enum


class Role(str, Enum):
    ADMIN = "admin"
    REVIEWER = "reviewer"
    REWARD_APPROVER = "reward_approver"
    ACCEPTOR = "acceptor"
    EMPLOYEE = "employee"


class UserStatus(str, Enum):
    ENABLED = "enabled"
    DISABLED = "disabled"


class Scenario(str, Enum):
    RD = "rd"
    OPS = "ops"
    DELIVERY = "delivery"
    SUPPORT = "support"
    OTHER = "other"


class ProblemFrequency(str, Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    OCCASIONAL = "occasional"


class ImpactScope(str, Enum):
    INDIVIDUAL = "individual"
    TEAM = "team"
    DEPARTMENT = "department"
    COMPANY = "company"


class ProblemStatus(str, Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    BUDGET_PENDING = "budget_pending"
    PRICING_REVISION_REQUIRED = "pricing_revision_required"
    APPROVED = "approved"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class TaskLevel(str, Enum):
    S = "S"
    A = "A"
    B = "B"
    C = "C"


class TaskStatus(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    PENDING_ACCEPTANCE = "pending_acceptance"
    COMPLETED = "completed"


class TaskActivityType(str, Enum):
    COMMENT = "comment"
    PROGRESS_UPDATE = "progress_update"
    BLOCKER = "blocker"
    OFFICIAL_NOTE = "official_note"
    SYSTEM_EVENT = "system_event"


class MilestoneStatus(str, Enum):
    PENDING = "pending"
    ACTIVE = "active"
    PENDING_ACCEPTANCE = "pending_acceptance"
    APPROVED = "approved"
    REWORK = "rework"
    CANCELLED = "cancelled"


class ClaimMode(str, Enum):
    INDIVIDUAL = "individual"
    TEAM = "team"


class ClaimStatus(str, Enum):
    ACTIVE = "active"
    COMPLETED = "completed"
    OVERDUE = "overdue"
    ABANDONED = "abandoned"


class ClaimApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class DeliverableStatus(str, Enum):
    SUBMITTED = "submitted"
    NEEDS_REWORK = "needs_rework"
    APPROVED = "approved"
    REJECTED = "rejected"


class AcceptanceResult(str, Enum):
    APPROVED = "approved"
    REWORK = "rework"
    REJECTED = "rejected"


class MilestoneAcceptanceResult(str, Enum):
    APPROVED = "approved"
    REWORK = "rework"
    CANCELLED = "cancelled"


class RewardRoleType(str, Enum):
    PROPOSER = "proposer"
    EXECUTOR = "executor"


class RewardStatus(str, Enum):
    GENERATED = "generated"
    CONFIRMED = "confirmed"


class MilestoneRewardHoldStatus(str, Enum):
    EARNED = "earned"
    RELEASED = "released"
    CANCELLED = "cancelled"



class AIProvider(str, Enum):
    """AI 供应商类型"""
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    DEEPSEEK = "deepseek"
    SILICONFLOW = "siliconflow"
    OLLAMA = "ollama"
    CUSTOM = "custom"


class AnalysisStatus(str, Enum):
    """问题论证状态"""
    PENDING = "pending"
    ANALYZING = "analyzing"
    COMPLETED = "completed"
    FAILED = "failed"


class HypothesisStatus(str, Enum):
    """假设验证状态"""
    PENDING = "pending"
    VERIFIED = "verified"
    REJECTED = "rejected"


class HypothesisType(str, Enum):
    """假设类型"""
    MARKET = "market"
    TECHNICAL = "technical"
    REQUIREMENT = "requirement"


class RiskLevel(str, Enum):
    """风险等级"""
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
