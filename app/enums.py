from enum import Enum


class Role(str, Enum):
    ADMIN = "admin"
    REVIEWER = "reviewer"
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
    PENDING_REVIEW = "pending_review"
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


class RewardRoleType(str, Enum):
    PROPOSER = "proposer"
    EXECUTOR = "executor"


class RewardStatus(str, Enum):
    GENERATED = "generated"
    CONFIRMED = "confirmed"


class BaselineResponsibilityStatus(str, Enum):
    GOOD = "good"
    NORMAL = "normal"
    FAULT = "fault"


class IncidentSeverity(str, Enum):
    NONE = "none"
    MINOR = "minor"
    MAJOR = "major"


class PerformanceLevel(str, Enum):
    R1 = "R1"
    R2 = "R2"
    R3 = "R3"
    R4 = "R4"
    R5 = "R5"
