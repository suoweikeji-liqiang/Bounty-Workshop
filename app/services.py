from __future__ import annotations

import json
from decimal import Decimal
from decimal import ROUND_HALF_UP
from datetime import date, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func, or_, update
from sqlmodel import Session, select

from app.enums import (
    AcceptanceResult,
    BaselineResponsibilityStatus,
    ClaimApprovalStatus,
    ClaimMode,
    ClaimStatus,
    DeliverableStatus,
    IncidentSeverity,
    PerformanceLevel,
    ProblemStatus,
    RewardRoleType,
    RewardStatus,
    Role,
    Scenario,
    TaskLevel,
    TaskStatus,
    UserStatus,
)
from app.attachments import bind_attachments
from app.models import (
    Acceptance,
    Claim,
    ClaimApprovalRequest,
    ClaimMember,
    Deliverable,
    Knowledge,
    OperationLog,
    PerformanceReviewSnapshot,
    Problem,
    Reward,
    SystemConfig,
    Task,
    User,
    UserRole,
)
from app.schemas import (
    AcceptanceHistoryItem,
    ClaimCreate,
    ClaimApprovalRequestRead,
    OperationLogRead,
    PersonalRewardStats,
    PersonalSummaryRead,
    PerformanceReviewRead,
    PerformanceReviewSignalInput,
    PerformanceReviewUpsert,
    ClaimExecutionDetailRead,
    ClaimExecutionRead,
    DashboardOverview,
    DeliverableCreate,
    PendingAcceptanceRead,
    ProblemCreate,
    ProblemRead,
    ProblemReview,
    RewardRead,
    RoleUpdate,
    TaskDetailRead,
    TaskRead,
    UserCreate,
    UserRead,
    UserStatusUpdate,
)


def _to_json(data: object) -> str:
    return json.dumps(data, ensure_ascii=False)


def _from_json(data: str) -> object:
    return json.loads(data)


def _from_json_list(data: str) -> list:
    try:
        parsed = _from_json(data)
    except Exception:
        return []
    return parsed if isinstance(parsed, list) else []


def _from_json_dict(data: str) -> dict:
    try:
        parsed = _from_json(data)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _decimal(value: float | int | str | Decimal) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value))


def _money_to_cents(value: Decimal) -> int:
    normalized = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int((normalized * 100).to_integral_value(rounding=ROUND_HALF_UP))


def _cents_to_amount(value: int) -> float:
    return float((Decimal(value) / Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _log(
    session: Session,
    actor_user_id: int | None,
    action: str,
    target_type: str,
    target_id: int | None,
    detail: dict,
) -> None:
    session.add(
        OperationLog(
            actor_user_id=actor_user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            detail=_to_json(detail),
        )
    )


def _ensure_user_exists(session: Session, user_id: int, allow_disabled: bool = False) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"user {user_id} not found")
    if not allow_disabled and user.status == UserStatus.DISABLED:
        raise HTTPException(status_code=403, detail=f"user {user_id} is disabled")
    return user


def _ensure_role(session: Session, user_id: int, role: Role) -> None:
    exists = session.exec(
        select(UserRole).where(UserRole.user_id == user_id, UserRole.role == role)
    ).first()
    if exists is None:
        raise HTTPException(status_code=400, detail=f"用户 {user_id} 未被授予 {role.value} 角色")


CLAIM_APPROVAL_OVERDUE_THRESHOLD_KEY = "claim_approval_overdue_threshold"
DEFAULT_CLAIM_APPROVAL_OVERDUE_THRESHOLD = 2
MIN_CLAIM_APPROVAL_OVERDUE_THRESHOLD = 1
PERFORMANCE_LEVEL_SCORE = {
    PerformanceLevel.R1: 1,
    PerformanceLevel.R2: 2,
    PerformanceLevel.R3: 3,
    PerformanceLevel.R4: 4,
    PerformanceLevel.R5: 5,
}
REWARD_HOLD_FINAL_LEVELS = {PerformanceLevel.R1, PerformanceLevel.R2}


def create_user(session: Session, actor_id: int, payload: UserCreate) -> UserRead:
    user = User(
        name=payload.name,
        employee_no=payload.employee_no,
        department=payload.department,
        email=payload.email,
    )
    session.add(user)
    session.flush()

    roles = payload.roles or [Role.EMPLOYEE]
    for role in set(roles):
        session.add(UserRole(user_id=user.id, role=role))

    _log(
        session=session,
        actor_user_id=actor_id,
        action="user.create",
        target_type="user",
        target_id=user.id,
        detail={"name": payload.name, "roles": [r.value for r in roles]},
    )
    session.commit()
    session.refresh(user)
    return user_to_read(session, user)


def set_user_roles(session: Session, actor_id: int, user_id: int, payload: RoleUpdate) -> UserRead:
    _ensure_user_exists(session, user_id, allow_disabled=True)
    for role_row in session.exec(select(UserRole).where(UserRole.user_id == user_id)).all():
        session.delete(role_row)
    roles = payload.roles or [Role.EMPLOYEE]
    for role in set(roles):
        session.add(UserRole(user_id=user_id, role=role))
    _log(
        session=session,
        actor_user_id=actor_id,
        action="user.role.update",
        target_type="user",
        target_id=user_id,
        detail={"roles": [r.value for r in roles]},
    )
    session.commit()
    return user_to_read(session, _ensure_user_exists(session, user_id, allow_disabled=True))


def set_user_status(
    session: Session,
    actor_id: int,
    user_id: int,
    payload: UserStatusUpdate,
) -> UserRead:
    user = _ensure_user_exists(session, user_id, allow_disabled=True)
    user.status = payload.status
    _log(
        session=session,
        actor_user_id=actor_id,
        action="user.status.update",
        target_type="user",
        target_id=user_id,
        detail={"status": payload.status.value},
    )
    session.commit()
    session.refresh(user)
    return user_to_read(session, user)


def user_to_read(session: Session, user: User) -> UserRead:
    roles = session.exec(select(UserRole).where(UserRole.user_id == user.id)).all()
    return UserRead(
        id=user.id,
        name=user.name,
        employee_no=user.employee_no,
        department=user.department,
        email=user.email,
        status=user.status.value,
        overdue_count=user.overdue_count,
        roles=[row.role for row in roles],
    )


def list_users(session: Session) -> list[UserRead]:
    users = session.exec(select(User).order_by(User.id)).all()
    return [user_to_read(session, item) for item in users]


def get_user_detail(session: Session, user_id: int) -> UserRead:
    user = _ensure_user_exists(session, user_id, allow_disabled=True)
    return user_to_read(session, user)


def list_active_users(session: Session) -> list[UserRead]:
    users = session.exec(
        select(User).where(User.status == UserStatus.ENABLED).order_by(User.id)
    ).all()
    return [user_to_read(session, item) for item in users]


def list_acceptor_candidates(session: Session) -> list[UserRead]:
    users = session.exec(
        select(User)
        .join(UserRole, UserRole.user_id == User.id)
        .where(UserRole.role == Role.ACCEPTOR, User.status == UserStatus.ENABLED)
        .order_by(User.id)
    ).all()
    return [user_to_read(session, item) for item in users]


def get_my_profile(session: Session, user_id: int) -> UserRead:
    user = _ensure_user_exists(session, user_id, allow_disabled=True)
    return user_to_read(session, user)


def get_my_summary(session: Session, user_id: int) -> PersonalSummaryRead:
    user = _ensure_user_exists(session, user_id, allow_disabled=True)
    rewards = list_rewards(session, user_id=user_id)
    confirmed_rewards = [item for item in rewards if item.status == RewardStatus.CONFIRMED.value]
    badges = sorted({item.badge for item in confirmed_rewards if item.badge})
    stats = PersonalRewardStats(
        total_records=len(rewards),
        confirmed_records=len(confirmed_rewards),
        confirmed_reward_amount=round(sum(item.amount for item in confirmed_rewards), 2),
        total_points=sum(item.points for item in rewards),
        confirmed_points=sum(item.points for item in confirmed_rewards),
    )
    return PersonalSummaryRead(
        user=user_to_read(session, user),
        stats=stats,
        badges=badges,
        rewards=rewards,
    )


def get_claim_approval_overdue_threshold(session: Session) -> int:
    row = session.get(SystemConfig, CLAIM_APPROVAL_OVERDUE_THRESHOLD_KEY)
    if row is None:
        value = DEFAULT_CLAIM_APPROVAL_OVERDUE_THRESHOLD
        session.add(SystemConfig(key=CLAIM_APPROVAL_OVERDUE_THRESHOLD_KEY, value=str(value)))
        session.commit()
        return value
    try:
        value = int(row.value)
    except ValueError:
        value = DEFAULT_CLAIM_APPROVAL_OVERDUE_THRESHOLD
    return max(value, MIN_CLAIM_APPROVAL_OVERDUE_THRESHOLD)


def set_claim_approval_overdue_threshold(session: Session, threshold: int) -> int:
    value = max(threshold, MIN_CLAIM_APPROVAL_OVERDUE_THRESHOLD)
    row = session.get(SystemConfig, CLAIM_APPROVAL_OVERDUE_THRESHOLD_KEY)
    now = datetime.utcnow()
    if row is None:
        session.add(
            SystemConfig(
                key=CLAIM_APPROVAL_OVERDUE_THRESHOLD_KEY,
                value=str(value),
                updated_at=now,
            )
        )
    else:
        row.value = str(value)
        row.updated_at = now
    session.commit()
    return value


def create_problem(session: Session, actor_id: int, payload: ProblemCreate) -> ProblemRead:
    _ensure_user_exists(session, actor_id)
    attachment_urls = list(payload.attachment_urls)
    problem = Problem(
        title=payload.title,
        scenario=payload.scenario,
        background=payload.background,
        frequency=payload.frequency,
        impact_scope=payload.impact_scope,
        description=payload.description,
        value_reduce_effort=payload.value_reduce_effort,
        value_reduce_cost=payload.value_reduce_cost,
        value_improve_quality=payload.value_improve_quality,
        value_statement=payload.value_statement,
        current_solution=payload.current_solution,
        attachment_urls="[]",
        submitter_id=actor_id,
    )
    session.add(problem)
    session.flush()
    attachment_urls.extend(
        bind_attachments(
            session=session,
            attachment_ids=payload.attachment_ids,
            entity_type="problem",
            entity_id=problem.id,
        )
    )
    problem.attachment_urls = _to_json(attachment_urls)
    _log(
        session=session,
        actor_user_id=actor_id,
        action="problem.create",
        target_type="problem",
        target_id=problem.id,
        detail={"title": payload.title},
    )
    session.commit()
    return ProblemRead(
        id=problem.id,
        title=problem.title,
        scenario=problem.scenario,
        status=problem.status,
        submitter_id=problem.submitter_id,
        created_at=problem.created_at,
    )


def list_problems(
    session: Session,
    user_id: int,
    mine_only: bool = False,
    status: ProblemStatus | None = None,
    scenario: Scenario | None = None,
    created_from: date | None = None,
    created_to: date | None = None,
    offset: int = 0,
    limit: int = 200,
) -> list[ProblemRead]:
    statement = select(Problem)
    if mine_only:
        statement = statement.where(Problem.submitter_id == user_id)
    if status is not None:
        statement = statement.where(Problem.status == status)
    if scenario is not None:
        statement = statement.where(Problem.scenario == scenario)
    if created_from is not None:
        statement = statement.where(
            Problem.created_at >= datetime.combine(created_from, datetime.min.time())
        )
    if created_to is not None:
        statement = statement.where(
            Problem.created_at < datetime.combine(created_to + timedelta(days=1), datetime.min.time())
        )
    safe_offset = max(offset, 0)
    safe_limit = max(1, min(limit, 200))
    problems = session.exec(
        statement.order_by(Problem.created_at.desc()).offset(safe_offset).limit(safe_limit)
    ).all()
    return [
        ProblemRead(
            id=item.id,
            title=item.title,
            scenario=item.scenario,
            status=item.status,
            submitter_id=item.submitter_id,
            created_at=item.created_at,
        )
        for item in problems
    ]


def review_problem(session: Session, actor_id: int, problem_id: int, payload: ProblemReview) -> TaskRead | None:
    problem = session.get(Problem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="问题不存在")

    if not payload.approve:
        updated = session.exec(
            update(Problem)
            .where(Problem.id == problem_id, Problem.status == ProblemStatus.PENDING_REVIEW)
            .values(
                status=ProblemStatus.REJECTED,
                reject_reason=payload.reject_reason,
                merged_problem_id=payload.merge_to_problem_id,
            )
        )
        if (updated.rowcount or 0) < 1:
            raise HTTPException(status_code=409, detail="problem already reviewed")
        _log(
            session,
            actor_id,
            "problem.reject",
            "problem",
            problem_id,
            {"reason": payload.reject_reason, "merge_to": payload.merge_to_problem_id},
        )
        session.commit()
        return None

    assert payload.task is not None
    _ensure_role(session, payload.task.accepter_id, Role.ACCEPTOR)

    updated = session.exec(
        update(Problem)
        .where(Problem.id == problem_id, Problem.status == ProblemStatus.PENDING_REVIEW)
        .values(
            status=ProblemStatus.APPROVED,
            reject_reason=None,
            merged_problem_id=None,
        )
    )
    if (updated.rowcount or 0) < 1:
        raise HTTPException(status_code=409, detail="problem already reviewed")

    task = Task(
        problem_id=problem.id,
        title=payload.task.title,
        goal=payload.task.goal,
        scope=payload.task.scope,
        due_date=payload.task.due_date,
        level=payload.task.level,
        reward_total=payload.task.reward_total,
        proposer_ratio=payload.task.proposer_ratio,
        accepter_id=payload.task.accepter_id,
        points=payload.task.points,
        badge=payload.task.badge,
        acceptance_criteria_json=_to_json(
            [item.model_dump() for item in payload.task.acceptance_criteria]
        ),
    )
    session.add(task)
    session.flush()

    _log(
        session,
        actor_id,
        "problem.approve",
        "problem",
        problem_id,
        {"task_id": task.id},
    )
    _log(
        session,
        actor_id,
        "task.create",
        "task",
        task.id,
        {"problem_id": problem_id, "level": task.level.value},
    )
    session.commit()
    return TaskRead(
        id=task.id,
        problem_id=task.problem_id,
        title=task.title,
        scenario=problem.scenario,
        level=task.level,
        reward_total=task.reward_total,
        active_claim_count=0,
        due_date=task.due_date,
        status=task.status.value,
        created_at=task.created_at,
    )


def list_tasks(
    session: Session,
    status: TaskStatus | None = None,
    level: TaskLevel | None = None,
    scenario: Scenario | None = None,
    reward_min: float | None = None,
    reward_max: float | None = None,
    offset: int = 0,
    limit: int = 200,
) -> list[TaskRead]:
    statement = select(Task, Problem.scenario).join(Problem, Problem.id == Task.problem_id)
    if status is not None:
        statement = statement.where(Task.status == status)
    if level is not None:
        statement = statement.where(Task.level == level)
    if scenario is not None:
        statement = statement.where(Problem.scenario == scenario)
    if reward_min is not None:
        statement = statement.where(Task.reward_total >= reward_min)
    if reward_max is not None:
        statement = statement.where(Task.reward_total <= reward_max)

    safe_offset = max(offset, 0)
    safe_limit = max(1, min(limit, 200))
    rows = session.exec(
        statement.order_by(Task.created_at.desc()).offset(safe_offset).limit(safe_limit)
    ).all()
    task_ids = [task.id for task, _ in rows]
    active_claim_map: dict[int, int] = {}
    if task_ids:
        claim_rows = session.exec(
            select(Claim.task_id, func.count(Claim.id))
            .where(Claim.task_id.in_(task_ids), Claim.status == ClaimStatus.ACTIVE)
            .group_by(Claim.task_id)
        ).all()
        active_claim_map = {int(task_id): int(count) for task_id, count in claim_rows}

    return [
        TaskRead(
            id=task.id,
            problem_id=task.problem_id,
            title=task.title,
            scenario=task_scenario,
            level=task.level,
            reward_total=task.reward_total,
            active_claim_count=active_claim_map.get(task.id, 0),
            due_date=task.due_date,
            status=task.status.value,
            created_at=task.created_at,
        )
        for task, task_scenario in rows
    ]


def get_task_detail(session: Session, task_id: int) -> TaskDetailRead:
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    acceptance_criteria = _from_json_list(task.acceptance_criteria_json)
    return TaskDetailRead(
        id=task.id,
        problem_id=task.problem_id,
        title=task.title,
        goal=task.goal,
        scope=task.scope,
        due_date=task.due_date,
        level=task.level,
        reward_total=task.reward_total,
        proposer_ratio=task.proposer_ratio,
        accepter_id=task.accepter_id,
        points=task.points,
        badge=task.badge,
        acceptance_criteria=acceptance_criteria,
        status=task.status.value,
        created_at=task.created_at,
    )


def list_my_claims(
    session: Session,
    user_id: int,
    status: ClaimStatus | None = None,
) -> list[ClaimExecutionRead]:
    statement = select(Claim).where(Claim.lead_user_id == user_id)
    if status is not None:
        statement = statement.where(Claim.status == status)
    claims = session.exec(statement.order_by(Claim.created_at.desc())).all()
    output: list[ClaimExecutionRead] = []
    for claim in claims:
        task = session.get(Task, claim.task_id)
        if task is None:
            continue
        deliverable = session.exec(select(Deliverable).where(Deliverable.claim_id == claim.id)).first()
        output.append(
            ClaimExecutionRead(
                claim_id=claim.id,
                claim_status=claim.status.value,
                claim_mode=claim.mode.value,
                task_id=task.id,
                task_title=task.title,
                task_status=task.status.value,
                due_date=task.due_date,
                deliverable_id=deliverable.id if deliverable else None,
                deliverable_status=deliverable.status.value if deliverable else None,
                deliverable_submitted_at=deliverable.submitted_at if deliverable else None,
            )
        )
    return output


def list_my_pending_acceptance(session: Session, user_id: int) -> list[PendingAcceptanceRead]:
    tasks = session.exec(
        select(Task).where(Task.accepter_id == user_id, Task.status == TaskStatus.PENDING_ACCEPTANCE)
    ).all()
    output: list[PendingAcceptanceRead] = []
    for task in tasks:
        claims = session.exec(select(Claim).where(Claim.task_id == task.id)).all()
        for claim in claims:
            deliverable = session.exec(
                select(Deliverable).where(
                    Deliverable.claim_id == claim.id,
                    Deliverable.status == DeliverableStatus.SUBMITTED,
                )
            ).first()
            if deliverable is None:
                continue
            output.append(
                PendingAcceptanceRead(
                    deliverable_id=deliverable.id,
                    claim_id=claim.id,
                    task_id=task.id,
                    task_title=task.title,
                    lead_user_id=claim.lead_user_id,
                    submitted_at=deliverable.submitted_at,
                    deliverable_status=deliverable.status.value,
                )
            )
    return sorted(output, key=lambda item: item.submitted_at, reverse=True)


def _load_claim_and_task(session: Session, claim_id: int) -> tuple[Claim, Task]:
    claim = session.get(Claim, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="揭榜记录不存在")
    task = session.get(Task, claim.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return claim, task


def _has_claim_access(actor_id: int, actor_roles: set[Role], claim: Claim, task: Task) -> bool:
    return (
        actor_id == claim.lead_user_id
        or actor_id == task.accepter_id
        or Role.ADMIN in actor_roles
        or Role.REVIEWER in actor_roles
    )


def _ensure_claim_access(actor_id: int, actor_roles: set[Role], claim: Claim, task: Task) -> None:
    if not _has_claim_access(actor_id, actor_roles, claim, task):
        raise HTTPException(status_code=403, detail="无权查看该揭榜详情")


def _min_performance_level(left: PerformanceLevel, right: PerformanceLevel) -> PerformanceLevel:
    return left if PERFORMANCE_LEVEL_SCORE[left] <= PERFORMANCE_LEVEL_SCORE[right] else right


def _calc_baseline_responsibility_status(
    signals: PerformanceReviewSignalInput,
) -> tuple[BaselineResponsibilityStatus, list[str]]:
    reasons: list[str] = []
    fault_reasons: list[str] = []
    normal_reasons: list[str] = []

    if signals.incident_severity == IncidentSeverity.MAJOR and signals.incident_count > 0:
        fault_reasons.append("发生重大事故（major）")
    if signals.critical_task_missed_without_reason:
        fault_reasons.append("关键职责任务遗漏且无正当理由")
    if signals.process_violation_count > 0:
        fault_reasons.append(f"流程违规 {signals.process_violation_count} 次")
    if signals.known_risk_unreported:
        fault_reasons.append("已知风险未上报")
    if signals.repeated_issue_count > 0 and signals.repeated_issue_without_improvement:
        fault_reasons.append("重复性问题跨周期出现且无改进")

    if signals.incident_severity == IncidentSeverity.MINOR and signals.incident_count >= 2:
        normal_reasons.append(f"轻微事故累计 {signals.incident_count} 次")
    if signals.missed_deadline_count >= 2:
        normal_reasons.append(f"非关键任务延期/遗漏累计 {signals.missed_deadline_count} 次")
    if signals.unjustified_delay_count > 0:
        normal_reasons.append(f"无合理理由延期 {signals.unjustified_delay_count} 次")
    if signals.repeated_issue_count > 0 and not signals.repeated_issue_without_improvement:
        normal_reasons.append(f"重复性问题出现 {signals.repeated_issue_count} 次（已有改进）")

    if fault_reasons:
        reasons.extend(fault_reasons)
        return BaselineResponsibilityStatus.FAULT, reasons
    if normal_reasons:
        reasons.extend(normal_reasons)
        return BaselineResponsibilityStatus.NORMAL, reasons
    return BaselineResponsibilityStatus.GOOD, reasons


def _calc_final_r_level(
    initial_r_level: PerformanceLevel,
    baseline_status: BaselineResponsibilityStatus,
    has_t3_plus_task: bool,
) -> tuple[PerformanceLevel, list[str]]:
    final_level = initial_r_level
    fusion_reasons: list[str] = []

    if baseline_status == BaselineResponsibilityStatus.FAULT:
        final_level = _min_performance_level(final_level, PerformanceLevel.R2)
        fusion_reasons.append("基础履责为 fault，最终 R 级别下拉至不高于 R2")
    elif baseline_status == BaselineResponsibilityStatus.NORMAL:
        normal_cap = PerformanceLevel.R3 if has_t3_plus_task else PerformanceLevel.R2
        final_level = _min_performance_level(final_level, normal_cap)
        fusion_reasons.append(f"基础履责为 normal，最终 R 级别不高于 {normal_cap.value}")
    else:
        good_cap = PerformanceLevel.R4 if has_t3_plus_task else PerformanceLevel.R3
        final_level = _min_performance_level(final_level, good_cap)
        fusion_reasons.append(f"基础履责为 good，最终 R 级别不高于 {good_cap.value}")

    if not has_t3_plus_task:
        final_level = _min_performance_level(final_level, PerformanceLevel.R3)
        fusion_reasons.append("无 T3+ 任务，最终 R 级别不高于 R3")

    return final_level, fusion_reasons


def _performance_snapshot_to_read(row: PerformanceReviewSnapshot) -> PerformanceReviewRead:
    baseline_reasons = [str(item) for item in _from_json_list(row.baseline_reasons)]

    return PerformanceReviewRead(
        claim_id=row.claim_id,
        task_id=row.task_id,
        deliverable_id=row.deliverable_id,
        reviewed_by_user_id=row.reviewed_by_user_id,
        baseline_responsibility_status=row.baseline_responsibility_status,
        baseline_reasons=baseline_reasons,
        incident_severity=row.incident_severity,
        incident_count=row.incident_count,
        missed_deadline_count=row.missed_deadline_count,
        unjustified_delay_count=row.unjustified_delay_count,
        process_violation_count=row.process_violation_count,
        known_risk_unreported=row.known_risk_unreported,
        repeated_issue_count=row.repeated_issue_count,
        critical_task_missed_without_reason=row.critical_task_missed_without_reason,
        repeated_issue_without_improvement=row.repeated_issue_without_improvement,
        has_t3_plus_task=row.has_t3_plus_task,
        initial_r_level=row.initial_r_level,
        final_r_level=row.final_r_level,
        has_fault_warning=row.baseline_responsibility_status == BaselineResponsibilityStatus.FAULT,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _latest_snapshot_by_task_ids(
    session: Session,
    task_ids: list[int],
) -> dict[int, PerformanceReviewSnapshot]:
    if not task_ids:
        return {}
    rows = session.exec(
        select(PerformanceReviewSnapshot)
        .where(PerformanceReviewSnapshot.task_id.in_(task_ids))
        .order_by(PerformanceReviewSnapshot.updated_at.desc())
    ).all()
    latest: dict[int, PerformanceReviewSnapshot] = {}
    for row in rows:
        if row.task_id not in latest:
            latest[row.task_id] = row
    return latest


def _reward_hold_reason(
    reward_role_type: RewardRoleType,
    snapshot: PerformanceReviewSnapshot | None,
) -> str | None:
    if snapshot is None:
        return None
    if (
        reward_role_type == RewardRoleType.EXECUTOR
        and snapshot.final_r_level in REWARD_HOLD_FINAL_LEVELS
    ):
        return (
            f"终评等级为 {snapshot.final_r_level.value}，执行人激励进入复核冻结；"
            "仅管理员可确认发放。"
        )
    return None


def _reward_to_read(
    reward: Reward,
    snapshot: PerformanceReviewSnapshot | None,
) -> RewardRead:
    hold_reason = _reward_hold_reason(reward.role_type, snapshot)
    return RewardRead(
        id=reward.id,
        task_id=reward.task_id,
        user_id=reward.user_id,
        role_type=reward.role_type.value,
        amount=reward.amount,
        points=reward.points,
        badge=reward.badge,
        status=reward.status.value,
        confirmed_at=reward.confirmed_at,
        held_by_performance_policy=hold_reason is not None and reward.status != RewardStatus.CONFIRMED,
        performance_baseline_status=snapshot.baseline_responsibility_status if snapshot else None,
        performance_final_r_level=snapshot.final_r_level if snapshot else None,
        hold_reason=hold_reason,
    )


def get_performance_review_snapshot(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    claim_id: int,
) -> PerformanceReviewRead:
    claim, task = _load_claim_and_task(session, claim_id)
    _ensure_claim_access(actor_id, actor_roles, claim, task)

    row = session.exec(
        select(PerformanceReviewSnapshot).where(PerformanceReviewSnapshot.claim_id == claim_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="终评快照不存在")
    return _performance_snapshot_to_read(row)


def upsert_performance_review_snapshot(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    claim_id: int,
    payload: PerformanceReviewUpsert,
) -> PerformanceReviewRead:
    claim, task = _load_claim_and_task(session, claim_id)
    if not (
        actor_id == task.accepter_id or Role.ADMIN in actor_roles or Role.REVIEWER in actor_roles
    ):
        raise HTTPException(status_code=403, detail="仅验收人/管理员/评审可录入终评快照")

    baseline_status, baseline_reasons = _calc_baseline_responsibility_status(payload.signals)
    final_r_level, fusion_reasons = _calc_final_r_level(
        payload.initial_r_level,
        baseline_status,
        payload.has_t3_plus_task,
    )
    all_reasons = baseline_reasons + fusion_reasons
    deliverable = session.exec(select(Deliverable).where(Deliverable.claim_id == claim_id)).first()

    row = session.exec(
        select(PerformanceReviewSnapshot).where(PerformanceReviewSnapshot.claim_id == claim_id)
    ).first()
    now = datetime.utcnow()
    if row is None:
        row = PerformanceReviewSnapshot(
            claim_id=claim_id,
            task_id=task.id,
            deliverable_id=deliverable.id if deliverable else None,
            reviewed_by_user_id=actor_id,
            created_at=now,
            updated_at=now,
        )
        session.add(row)

    signals = payload.signals
    row.task_id = task.id
    row.deliverable_id = deliverable.id if deliverable else None
    row.reviewed_by_user_id = actor_id
    row.baseline_responsibility_status = baseline_status
    row.baseline_reasons = _to_json(all_reasons)
    row.incident_severity = signals.incident_severity
    row.incident_count = signals.incident_count
    row.missed_deadline_count = signals.missed_deadline_count
    row.unjustified_delay_count = signals.unjustified_delay_count
    row.process_violation_count = signals.process_violation_count
    row.known_risk_unreported = signals.known_risk_unreported
    row.repeated_issue_count = signals.repeated_issue_count
    row.critical_task_missed_without_reason = signals.critical_task_missed_without_reason
    row.repeated_issue_without_improvement = signals.repeated_issue_without_improvement
    row.has_t3_plus_task = payload.has_t3_plus_task
    row.initial_r_level = payload.initial_r_level
    row.final_r_level = final_r_level
    row.updated_at = now

    _log(
        session,
        actor_id,
        "performance.review.upsert",
        "claim",
        claim_id,
        {
            "task_id": task.id,
            "baseline_status": baseline_status.value,
            "initial_r_level": payload.initial_r_level.value,
            "final_r_level": final_r_level.value,
            "has_t3_plus_task": payload.has_t3_plus_task,
        },
    )
    session.commit()
    session.refresh(row)
    return _performance_snapshot_to_read(row)


def get_claim_execution_detail(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    claim_id: int,
) -> ClaimExecutionDetailRead:
    claim, task = _load_claim_and_task(session, claim_id)
    _ensure_claim_access(actor_id, actor_roles, claim, task)

    deliverable = session.exec(select(Deliverable).where(Deliverable.claim_id == claim.id)).first()
    acceptance_history: list[AcceptanceHistoryItem] = []
    if deliverable:
        rows = session.exec(
            select(Acceptance).where(Acceptance.deliverable_id == deliverable.id).order_by(Acceptance.created_at.desc())
        ).all()
        acceptance_history = [
            AcceptanceHistoryItem(
                acceptance_id=item.id,
                accepter_id=item.accepter_id,
                result=item.result,
                comment=item.comment,
                created_at=item.created_at,
            )
            for item in rows
        ]

    acceptance_criteria = _from_json_list(task.acceptance_criteria_json)

    evidence_urls: list[str] = []
    criteria_results: list[str] = []
    if deliverable:
        evidence_urls = [str(item) for item in _from_json_list(deliverable.evidence_urls)]
        criteria_results = [str(item) for item in _from_json_list(deliverable.criteria_results_json)]

    performance_row = session.exec(
        select(PerformanceReviewSnapshot).where(PerformanceReviewSnapshot.claim_id == claim_id)
    ).first()
    performance_review = _performance_snapshot_to_read(performance_row) if performance_row else None

    return ClaimExecutionDetailRead(
        claim_id=claim.id,
        claim_status=claim.status.value,
        claim_mode=claim.mode.value,
        lead_user_id=claim.lead_user_id,
        task_id=task.id,
        task_title=task.title,
        task_goal=task.goal,
        task_scope=task.scope,
        task_status=task.status.value,
        due_date=task.due_date,
        acceptance_criteria=acceptance_criteria,
        deliverable_id=deliverable.id if deliverable else None,
        deliverable_status=deliverable.status.value if deliverable else None,
        deliverable_summary=deliverable.summary if deliverable else None,
        evidence_urls=evidence_urls,
        criteria_results=criteria_results,
        submitted_at=deliverable.submitted_at if deliverable else None,
        acceptance_history=acceptance_history,
        performance_review=performance_review,
    )


def _approval_request_to_read(session: Session, row: ClaimApprovalRequest) -> ClaimApprovalRequestRead:
    task = session.get(Task, row.task_id)
    applicant = session.get(User, row.applicant_user_id)
    return ClaimApprovalRequestRead(
        id=row.id,
        task_id=row.task_id,
        task_title=task.title if task else f"task #{row.task_id}",
        applicant_user_id=row.applicant_user_id,
        applicant_user_name=applicant.name if applicant else f"user #{row.applicant_user_id}",
        applicant_overdue_count=applicant.overdue_count if applicant else 0,
        status=row.status.value,
        reason=row.reason,
        reviewed_by_user_id=row.reviewed_by_user_id,
        reviewed_at=row.reviewed_at,
        created_at=row.created_at,
    )


def _create_or_get_pending_approval_request(
    session: Session,
    task_id: int,
    applicant_user_id: int,
    reason: str | None = None,
) -> ClaimApprovalRequest:
    existing = session.exec(
        select(ClaimApprovalRequest).where(
            ClaimApprovalRequest.task_id == task_id,
            ClaimApprovalRequest.applicant_user_id == applicant_user_id,
            ClaimApprovalRequest.status == ClaimApprovalStatus.PENDING,
        )
    ).first()
    if existing is not None:
        return existing
    record = ClaimApprovalRequest(
        task_id=task_id,
        applicant_user_id=applicant_user_id,
        status=ClaimApprovalStatus.PENDING,
        reason=reason,
    )
    session.add(record)
    session.flush()
    return record


def list_claim_approval_requests(
    session: Session,
    actor_id: int,
    mine_only: bool = False,
    status: ClaimApprovalStatus | None = None,
) -> list[ClaimApprovalRequestRead]:
    statement = select(ClaimApprovalRequest)
    if mine_only:
        statement = statement.where(ClaimApprovalRequest.applicant_user_id == actor_id)
    if status is not None:
        statement = statement.where(ClaimApprovalRequest.status == status)
    rows = session.exec(statement.order_by(ClaimApprovalRequest.created_at.desc())).all()
    return [_approval_request_to_read(session, row) for row in rows]


def approve_claim_approval_request(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    request_id: int,
    comment: str | None = None,
) -> dict:
    row = session.get(ClaimApprovalRequest, request_id)
    if row is None:
        raise HTTPException(status_code=404, detail="approval request not found")
    if row.status != ClaimApprovalStatus.PENDING:
        raise HTTPException(status_code=400, detail="approval request already reviewed")

    claim_result = claim_task(
        session=session,
        actor_id=actor_id,
        actor_roles=actor_roles,
        task_id=row.task_id,
        payload=ClaimCreate(mode=ClaimMode.INDIVIDUAL, lead_user_id=row.applicant_user_id, members=[]),
    )

    row.status = ClaimApprovalStatus.APPROVED
    row.reviewed_by_user_id = actor_id
    row.reviewed_at = datetime.utcnow()
    if comment and comment.strip():
        base = (row.reason or "").strip()
        suffix = f"[review] {comment.strip()}"
        row.reason = f"{base}\n{suffix}".strip()
    _log(
        session,
        actor_id,
        "task.claim.approval.approve",
        "claim_approval_request",
        row.id,
        {"task_id": row.task_id, "applicant_user_id": row.applicant_user_id, "claim_id": claim_result["claim_id"]},
    )
    session.commit()
    return {
        "request_id": row.id,
        "status": row.status.value,
        "claim_id": claim_result["claim_id"],
        "task_id": row.task_id,
    }


def reject_claim_approval_request(
    session: Session,
    actor_id: int,
    request_id: int,
    comment: str | None = None,
) -> dict:
    row = session.get(ClaimApprovalRequest, request_id)
    if row is None:
        raise HTTPException(status_code=404, detail="approval request not found")
    if row.status != ClaimApprovalStatus.PENDING:
        raise HTTPException(status_code=400, detail="approval request already reviewed")

    row.status = ClaimApprovalStatus.REJECTED
    row.reviewed_by_user_id = actor_id
    row.reviewed_at = datetime.utcnow()
    if comment and comment.strip():
        base = (row.reason or "").strip()
        suffix = f"[review] {comment.strip()}"
        row.reason = f"{base}\n{suffix}".strip()

    _log(
        session,
        actor_id,
        "task.claim.approval.reject",
        "claim_approval_request",
        row.id,
        {"task_id": row.task_id, "applicant_user_id": row.applicant_user_id},
    )
    session.commit()
    return {"request_id": row.id, "status": row.status.value, "task_id": row.task_id}


def claim_task(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    task_id: int,
    payload: ClaimCreate,
) -> dict:
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status not in {TaskStatus.OPEN, TaskStatus.IN_PROGRESS}:
        raise HTTPException(status_code=400, detail="当前任务不可揭榜")

    lead_user_id = payload.lead_user_id or actor_id
    lead_user = _ensure_user_exists(session, lead_user_id)
    _ensure_user_exists(session, actor_id)

    can_approve_for_others = Role.ADMIN in actor_roles or Role.REVIEWER in actor_roles
    if lead_user_id != actor_id and not can_approve_for_others:
        raise HTTPException(status_code=403, detail="only admin/reviewer can claim for another user")

    overdue_threshold = get_claim_approval_overdue_threshold(session)
    if lead_user.overdue_count >= overdue_threshold:
        if actor_id == lead_user_id:
            approval_request = _create_or_get_pending_approval_request(
                session=session,
                task_id=task_id,
                applicant_user_id=lead_user_id,
                reason=(
                    f"overdue_count={lead_user.overdue_count}, "
                    f"threshold={overdue_threshold}, waiting admin/reviewer approval"
                ),
            )
            _log(
                session,
                actor_id,
                "task.claim.overdue_blocked",
                "claim_approval_request",
                approval_request.id,
                {
                    "task_id": task_id,
                    "lead_user_id": lead_user_id,
                    "overdue_count": lead_user.overdue_count,
                    "overdue_threshold": overdue_threshold,
                },
            )
            session.commit()
            raise HTTPException(
                status_code=403,
                detail=(
                    "claim requires approval: overdue count reached threshold, "
                    f"ask admin/reviewer to claim on behalf, request_id={approval_request.id}"
                ),
            )
        if not can_approve_for_others:
            raise HTTPException(status_code=403, detail="only admin/reviewer can approve overdue claims")

    existing_active = session.exec(
        select(Claim).where(
            Claim.task_id == task_id,
            Claim.lead_user_id == lead_user_id,
            Claim.status == ClaimStatus.ACTIVE,
        )
    ).first()
    if existing_active is not None:
        raise HTTPException(status_code=400, detail="该负责人已有进行中的揭榜记录")

    claim = Claim(task_id=task_id, lead_user_id=lead_user_id, mode=payload.mode)
    session.add(claim)
    session.flush()

    if payload.mode == ClaimMode.INDIVIDUAL:
        session.add(ClaimMember(claim_id=claim.id, user_id=lead_user_id, ratio=1.0))
    else:
        member_ids = {member.user_id for member in payload.members}
        if lead_user_id not in member_ids:
            raise HTTPException(status_code=400, detail="联合揭榜成员中必须包含主负责人")
        for member in payload.members:
            _ensure_user_exists(session, member.user_id)
            session.add(ClaimMember(claim_id=claim.id, user_id=member.user_id, ratio=member.ratio))

    task.status = TaskStatus.IN_PROGRESS
    _log(
        session,
        actor_id,
        "task.claim",
        "task",
        task_id,
        {
            "claim_id": claim.id,
            "mode": claim.mode.value,
            "lead_user_id": lead_user_id,
            "overdue_count": lead_user.overdue_count,
            "overdue_threshold": overdue_threshold,
        },
    )
    if lead_user.overdue_count >= overdue_threshold and lead_user_id != actor_id:
        _log(
            session,
            actor_id,
            "task.claim.overdue_approved",
            "task",
            task_id,
            {
                "claim_id": claim.id,
                "lead_user_id": lead_user_id,
                "overdue_count": lead_user.overdue_count,
                "overdue_threshold": overdue_threshold,
            },
        )
    session.commit()
    return {"claim_id": claim.id, "task_id": task_id, "status": claim.status.value}


def abandon_claim(session: Session, actor_id: int, claim_id: int) -> dict:
    _ensure_user_exists(session, actor_id)
    claim = session.get(Claim, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="揭榜记录不存在")
    if claim.status != ClaimStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="当前揭榜状态不可放弃")
    if actor_id != claim.lead_user_id:
        raise HTTPException(status_code=403, detail="仅揭榜主负责人可放弃")

    task = session.get(Task, claim.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    claim.status = ClaimStatus.ABANDONED
    active_claims = session.exec(
        select(func.count())
        .select_from(Claim)
        .where(Claim.task_id == task.id, Claim.status == ClaimStatus.ACTIVE)
    ).one()
    task.status = TaskStatus.IN_PROGRESS if int(active_claims) > 0 else TaskStatus.OPEN

    _log(
        session,
        actor_id,
        "task.claim.abandon",
        "claim",
        claim_id,
        {"task_id": task.id},
    )
    session.commit()
    return {"claim_id": claim_id, "status": claim.status.value, "task_status": task.status.value}


def submit_deliverable(
    session: Session, actor_id: int, claim_id: int, payload: DeliverableCreate
) -> dict:
    claim = session.get(Claim, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="揭榜记录不存在")
    if claim.status != ClaimStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="当前揭榜状态不可提交成果")

    if claim.mode == ClaimMode.TEAM and actor_id != claim.lead_user_id:
        raise HTTPException(status_code=403, detail="联合揭榜仅主负责人可提交成果")
    if claim.mode == ClaimMode.INDIVIDUAL and actor_id != claim.lead_user_id:
        raise HTTPException(status_code=403, detail="仅揭榜人可提交成果")

    existing = session.exec(select(Deliverable).where(Deliverable.claim_id == claim_id)).first()
    if existing is not None and existing.status == DeliverableStatus.SUBMITTED:
        raise HTTPException(status_code=400, detail="已有待验收成果，不能重复提交")

    evidence_urls = list(payload.evidence_urls)
    if existing is None:
        deliverable = Deliverable(
            claim_id=claim_id,
            summary=payload.summary,
            evidence_urls="[]",
            criteria_results_json=_to_json(payload.criteria_results),
            status=DeliverableStatus.SUBMITTED,
        )
        session.add(deliverable)
        session.flush()
    else:
        existing.summary = payload.summary
        existing.evidence_urls = "[]"
        existing.criteria_results_json = _to_json(payload.criteria_results)
        existing.status = DeliverableStatus.SUBMITTED
        existing.submitted_at = datetime.utcnow()
        deliverable = existing

    evidence_urls.extend(
        bind_attachments(
            session=session,
            attachment_ids=payload.evidence_attachment_ids,
            entity_type="deliverable",
            entity_id=deliverable.id,
        )
    )
    deliverable.evidence_urls = _to_json(evidence_urls)

    task = session.get(Task, claim.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    task.status = TaskStatus.PENDING_ACCEPTANCE
    _log(
        session,
        actor_id,
        "deliverable.submit",
        "deliverable",
        deliverable.id,
        {"claim_id": claim_id},
    )
    session.commit()
    return {"deliverable_id": deliverable.id, "status": deliverable.status.value}


def _generate_rewards_and_knowledge(session: Session, task: Task, claim: Claim, deliverable: Deliverable) -> None:
    existing = session.exec(select(Reward).where(Reward.task_id == task.id)).first()
    if existing is not None:
        return

    problem = session.get(Problem, task.problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="问题不存在")

    total_reward = _decimal(task.reward_total)
    proposer_ratio = _decimal(task.proposer_ratio)
    total_cents = _money_to_cents(total_reward)
    proposer_cents = _money_to_cents(total_reward * proposer_ratio)
    proposer_cents = max(0, min(proposer_cents, total_cents))
    executors_total_cents = total_cents - proposer_cents

    session.add(
        Reward(
            task_id=task.id,
            user_id=problem.submitter_id,
            role_type=RewardRoleType.PROPOSER,
            amount=_cents_to_amount(proposer_cents),
        )
    )

    members = session.exec(select(ClaimMember).where(ClaimMember.claim_id == claim.id)).all()
    if not members:
        members = [ClaimMember(claim_id=claim.id, user_id=claim.lead_user_id, ratio=1.0)]

    ordered_indexes = sorted(
        range(len(members)),
        key=lambda idx: (
            _decimal(members[idx].ratio),
            -int(members[idx].user_id or 0),
        ),
        reverse=True,
    )
    member_cents: list[int] = []
    for member in members:
        ratio_decimal = _decimal(member.ratio)
        raw_cents = _decimal(executors_total_cents) * ratio_decimal
        member_cents.append(
            int(raw_cents.to_integral_value(rounding=ROUND_HALF_UP))
        )

    diff = executors_total_cents - sum(member_cents)
    if member_cents and diff != 0:
        step = 1 if diff > 0 else -1
        cursor = 0
        while diff != 0:
            target_idx = ordered_indexes[cursor % len(ordered_indexes)]
            if step < 0 and member_cents[target_idx] <= 0:
                cursor += 1
                continue
            member_cents[target_idx] += step
            diff -= step
            cursor += 1

    for idx, member in enumerate(members):
        amount = _cents_to_amount(member_cents[idx])
        session.add(
            Reward(
                task_id=task.id,
                user_id=member.user_id,
                role_type=RewardRoleType.EXECUTOR,
                amount=amount,
                points=task.points,
                badge=task.badge,
            )
        )

    if session.exec(select(Knowledge).where(Knowledge.task_id == task.id)).first() is None:
        knowledge = Knowledge(
            task_id=task.id,
            problem_summary=f"{problem.title} | {problem.description[:120]}",
            solution_summary=f"{task.goal} | {deliverable.summary[:200]}",
            tags=_to_json([problem.scenario.value, task.level.value]),
            recommended=False,
        )
        session.add(knowledge)

    problem.status = ProblemStatus.ARCHIVED


def accept_deliverable(
    session: Session,
    actor_id: int,
    deliverable_id: int,
    result: AcceptanceResult,
    comment: str | None,
) -> dict:
    deliverable = session.get(Deliverable, deliverable_id)
    if deliverable is None:
        raise HTTPException(status_code=404, detail="成果不存在")
    claim = session.get(Claim, deliverable.claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="揭榜记录不存在")
    task = session.get(Task, claim.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if actor_id != task.accepter_id:
        raise HTTPException(status_code=403, detail="仅任务验收人可执行验收")

    acceptance = Acceptance(
        deliverable_id=deliverable.id,
        accepter_id=actor_id,
        result=result.value,
        comment=comment,
    )
    session.add(acceptance)

    if result == AcceptanceResult.REWORK:
        deliverable.status = DeliverableStatus.NEEDS_REWORK
        task.status = TaskStatus.IN_PROGRESS
    elif result == AcceptanceResult.REJECTED:
        deliverable.status = DeliverableStatus.REJECTED
        claim.status = ClaimStatus.ABANDONED
        active_claims = int(
            session.exec(
                select(func.count())
                .select_from(Claim)
                .where(
                    Claim.task_id == task.id,
                    Claim.status == ClaimStatus.ACTIVE,
                    Claim.id != claim.id,
                )
            ).one()
        )
        task.status = TaskStatus.IN_PROGRESS if active_claims > 0 else TaskStatus.OPEN
    else:
        deliverable.status = DeliverableStatus.APPROVED
        claim.status = ClaimStatus.COMPLETED
        task.status = TaskStatus.COMPLETED
        _generate_rewards_and_knowledge(session, task, claim, deliverable)

    _log(
        session,
        actor_id,
        "deliverable.accept",
        "deliverable",
        deliverable_id,
        {"result": result.value},
    )
    session.commit()
    return {"deliverable_id": deliverable_id, "result": result.value, "task_status": task.status.value}


def list_rewards(
    session: Session,
    user_id: int | None = None,
    status: RewardStatus | None = None,
    held_only: bool = False,
    offset: int = 0,
    limit: int = 200,
) -> list[RewardRead]:
    statement = select(Reward)
    if user_id is not None:
        statement = statement.where(Reward.user_id == user_id)
    if status is not None:
        statement = statement.where(Reward.status == status)
    safe_offset = max(offset, 0)
    safe_limit = max(1, min(limit, 200))
    rows = session.exec(
        statement.order_by(Reward.created_at.desc()).offset(safe_offset).limit(safe_limit)
    ).all()
    snapshot_map = _latest_snapshot_by_task_ids(session, [row.task_id for row in rows if row.task_id is not None])
    output = [_reward_to_read(row, snapshot_map.get(row.task_id)) for row in rows]
    if held_only:
        output = [row for row in output if row.held_by_performance_policy]
    return output


def confirm_reward(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    reward_id: int,
) -> RewardRead:
    reward = session.get(Reward, reward_id)
    if reward is None:
        raise HTTPException(status_code=404, detail="激励记录不存在")
    snapshot = session.exec(
        select(PerformanceReviewSnapshot)
        .where(PerformanceReviewSnapshot.task_id == reward.task_id)
        .order_by(PerformanceReviewSnapshot.updated_at.desc())
    ).first()
    hold_reason = _reward_hold_reason(reward.role_type, snapshot)
    if hold_reason and Role.ADMIN not in actor_roles:
        raise HTTPException(status_code=403, detail=hold_reason)
    reward.status = RewardStatus.CONFIRMED
    reward.confirmed_at = datetime.utcnow()
    _log(
        session,
        actor_id,
        "reward.confirm",
        "reward",
        reward_id,
        {
            "task_id": reward.task_id,
            "held_override": bool(hold_reason and Role.ADMIN in actor_roles),
        },
    )
    session.commit()
    session.refresh(reward)
    return _reward_to_read(reward, snapshot)


def _knowledge_to_dict(item: Knowledge) -> dict:
    tags = [str(tag) for tag in _from_json_list(item.tags)]
    scenario = tags[0] if len(tags) > 0 else None
    level = tags[1] if len(tags) > 1 else None
    return {
        "id": item.id,
        "task_id": item.task_id,
        "problem_summary": item.problem_summary,
        "solution_summary": item.solution_summary,
        "tags": tags,
        "scenario": scenario,
        "level": level,
        "recommended": item.recommended,
        "archived_at": item.archived_at,
    }


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def list_knowledge(
    session: Session,
    keyword: str | None = None,
    scenario: str | None = None,
    level: str | None = None,
    recommended: bool | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[dict]:
    statement = select(Knowledge)
    if keyword:
        needle = keyword.strip().lower()
        if needle:
            escaped = _escape_like(needle)
            like_value = f"%{escaped}%"
            statement = statement.where(
                or_(
                    func.lower(Knowledge.problem_summary).like(like_value, escape="\\"),
                    func.lower(Knowledge.solution_summary).like(like_value, escape="\\"),
                    func.lower(Knowledge.tags).like(like_value, escape="\\"),
                )
            )
    if scenario:
        statement = statement.where(Knowledge.tags.like(f'%"{_escape_like(scenario)}"%', escape="\\"))
    if level:
        statement = statement.where(Knowledge.tags.like(f'%"{_escape_like(level)}"%', escape="\\"))
    if recommended is not None:
        statement = statement.where(Knowledge.recommended == recommended)

    safe_offset = max(offset, 0)
    safe_limit = max(min(limit, 200), 1)
    rows = session.exec(
        statement.order_by(Knowledge.archived_at.desc()).offset(safe_offset).limit(safe_limit)
    ).all()
    return [_knowledge_to_dict(item) for item in rows]


def get_knowledge_detail(session: Session, knowledge_id: int) -> dict:
    item = session.get(Knowledge, knowledge_id)
    if item is None:
        raise HTTPException(status_code=404, detail="知识条目不存在")
    return _knowledge_to_dict(item)


def list_operation_logs(
    session: Session,
    action: str | None = None,
    actor_user_id: int | None = None,
    created_from: date | None = None,
    created_to: date | None = None,
    limit: int = 200,
) -> list[OperationLogRead]:
    statement = select(OperationLog)
    if action:
        statement = statement.where(OperationLog.action == action)
    if actor_user_id is not None:
        statement = statement.where(OperationLog.actor_user_id == actor_user_id)
    if created_from is not None:
        statement = statement.where(
            OperationLog.created_at >= datetime.combine(created_from, datetime.min.time())
        )
    if created_to is not None:
        statement = statement.where(
            OperationLog.created_at < datetime.combine(created_to + timedelta(days=1), datetime.min.time())
        )

    rows = session.exec(statement.order_by(OperationLog.created_at.desc()).limit(max(1, min(limit, 1000)))).all()
    output: list[OperationLogRead] = []
    for row in rows:
        detail = _from_json_dict(row.detail)
        output.append(
            OperationLogRead(
                id=row.id,
                actor_user_id=row.actor_user_id,
                action=row.action,
                target_type=row.target_type,
                target_id=row.target_id,
                detail=detail,
                created_at=row.created_at,
            )
        )
    return output


def release_overdue_claims(
    session: Session,
    actor_id: int | None = None,
    today: date | None = None,
) -> dict:
    # Boundary rule: only tasks with due_date strictly before today are overdue.
    current_day = today or date.today()
    rows = session.exec(
        select(Claim, Task)
        .join(Task, Task.id == Claim.task_id)
        .where(
            Claim.status == ClaimStatus.ACTIVE,
            Task.status != TaskStatus.COMPLETED,
            Task.due_date < current_day,
        )
    ).all()
    released = 0
    for claim, task in rows:
        claim.status = ClaimStatus.OVERDUE
        task.status = TaskStatus.OPEN
        lead = session.get(User, claim.lead_user_id)
        if lead is not None:
            lead.overdue_count += 1
        released += 1
        _log(
            session,
            actor_id,
            "task.release.overdue",
            "claim",
            claim.id,
            {"task_id": task.id, "rule": "due_date < today"},
        )
    session.commit()
    return {"released_claims": released, "rule": "due_date < today"}


def dashboard_overview(session: Session) -> DashboardOverview:
    problem_total = session.exec(select(func.count()).select_from(Problem)).one()
    problem_approved = session.exec(
        select(func.count()).select_from(Problem).where(Problem.status == ProblemStatus.APPROVED)
    ).one()
    task_total = session.exec(select(func.count()).select_from(Task)).one()
    task_completed = session.exec(
        select(func.count()).select_from(Task).where(Task.status == TaskStatus.COMPLETED)
    ).one()
    task_overdue_claims = session.exec(
        select(func.count()).select_from(Claim).where(Claim.status == ClaimStatus.OVERDUE)
    ).one()
    reward_total_confirmed_amount = session.exec(
        select(func.coalesce(func.sum(Reward.amount), 0.0)).where(Reward.status == RewardStatus.CONFIRMED)
    ).one()
    snapshot_rows = session.exec(select(PerformanceReviewSnapshot)).all()
    performance_review_count = len(snapshot_rows)
    performance_fault_count = sum(
        1
        for row in snapshot_rows
        if row.baseline_responsibility_status == BaselineResponsibilityStatus.FAULT
    )
    hold_task_ids = {
        row.task_id for row in snapshot_rows if row.final_r_level in REWARD_HOLD_FINAL_LEVELS
    }
    reward_hold_count = 0
    if hold_task_ids:
        reward_hold_count = int(
            session.exec(
                select(func.count())
                .select_from(Reward)
                .where(
                    Reward.task_id.in_(hold_task_ids),
                    Reward.role_type == RewardRoleType.EXECUTOR,
                    Reward.status == RewardStatus.GENERATED,
                )
            ).one()
        )
    completion_rate = (int(task_completed) / int(task_total)) if int(task_total) > 0 else 0.0
    overdue_rate = (int(task_overdue_claims) / int(task_total)) if int(task_total) > 0 else 0.0

    return DashboardOverview(
        problem_total=int(problem_total),
        problem_approved=int(problem_approved),
        task_total=int(task_total),
        task_completed=int(task_completed),
        task_overdue_claims=int(task_overdue_claims),
        task_completion_rate=round(completion_rate, 4),
        task_overdue_rate=round(overdue_rate, 4),
        reward_total_confirmed_amount=float(reward_total_confirmed_amount or 0.0),
        performance_review_count=performance_review_count,
        performance_fault_count=performance_fault_count,
        reward_hold_count=reward_hold_count,
    )
