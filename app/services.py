from __future__ import annotations

import json
from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import func
from sqlmodel import Session, select

from app.enums import (
    AcceptanceResult,
    ClaimMode,
    ClaimStatus,
    DeliverableStatus,
    ProblemStatus,
    RewardRoleType,
    RewardStatus,
    Role,
    TaskStatus,
)
from app.attachments import bind_attachments
from app.models import (
    Acceptance,
    Claim,
    ClaimMember,
    Deliverable,
    Knowledge,
    OperationLog,
    Problem,
    Reward,
    Task,
    User,
    UserRole,
)
from app.schemas import (
    AcceptanceHistoryItem,
    ClaimCreate,
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
    TaskRead,
    UserCreate,
    UserRead,
)


def _to_json(data: object) -> str:
    return json.dumps(data, ensure_ascii=False)


def _from_json(data: str) -> list | dict:
    return json.loads(data)


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


def _ensure_user_exists(session: Session, user_id: int) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"用户 {user_id} 不存在")
    return user


def _ensure_role(session: Session, user_id: int, role: Role) -> None:
    exists = session.exec(
        select(UserRole).where(UserRole.user_id == user_id, UserRole.role == role)
    ).first()
    if exists is None:
        raise HTTPException(status_code=400, detail=f"用户 {user_id} 未被授予 {role.value} 角色")


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
    _ensure_user_exists(session, user_id)
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
    return user_to_read(session, _ensure_user_exists(session, user_id))


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


def get_my_profile(session: Session, user_id: int) -> UserRead:
    user = _ensure_user_exists(session, user_id)
    return user_to_read(session, user)


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
) -> list[ProblemRead]:
    statement = select(Problem)
    if mine_only:
        statement = statement.where(Problem.submitter_id == user_id)
    if status is not None:
        statement = statement.where(Problem.status == status)
    problems = session.exec(statement.order_by(Problem.created_at.desc())).all()
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
    if problem.status != ProblemStatus.PENDING_REVIEW:
        raise HTTPException(status_code=400, detail="仅待审核问题可评审")

    if not payload.approve:
        problem.status = ProblemStatus.REJECTED
        problem.reject_reason = payload.reject_reason
        problem.merged_problem_id = payload.merge_to_problem_id
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
    problem.status = ProblemStatus.APPROVED
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
        level=task.level,
        reward_total=task.reward_total,
        due_date=task.due_date,
        status=task.status.value,
        created_at=task.created_at,
    )


def list_tasks(session: Session, status: TaskStatus | None = None) -> list[TaskRead]:
    statement = select(Task)
    if status is not None:
        statement = statement.where(Task.status == status)
    tasks = session.exec(statement.order_by(Task.created_at.desc())).all()
    return [
        TaskRead(
            id=item.id,
            problem_id=item.problem_id,
            title=item.title,
            level=item.level,
            reward_total=item.reward_total,
            due_date=item.due_date,
            status=item.status.value,
            created_at=item.created_at,
        )
        for item in tasks
    ]


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


def get_claim_execution_detail(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    claim_id: int,
) -> ClaimExecutionDetailRead:
    claim = session.get(Claim, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="揭榜记录不存在")
    task = session.get(Task, claim.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    allowed = (
        actor_id == claim.lead_user_id
        or actor_id == task.accepter_id
        or Role.ADMIN in actor_roles
        or Role.REVIEWER in actor_roles
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="无权查看该揭榜详情")

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

    acceptance_criteria = []
    try:
        acceptance_criteria = _from_json(task.acceptance_criteria_json)
    except Exception:
        acceptance_criteria = []

    evidence_urls: list[str] = []
    criteria_results: list[str] = []
    if deliverable:
        try:
            evidence_urls = list(_from_json(deliverable.evidence_urls))
        except Exception:
            evidence_urls = []
        try:
            criteria_results = list(_from_json(deliverable.criteria_results_json))
        except Exception:
            criteria_results = []

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
        acceptance_criteria=acceptance_criteria if isinstance(acceptance_criteria, list) else [],
        deliverable_id=deliverable.id if deliverable else None,
        deliverable_status=deliverable.status.value if deliverable else None,
        deliverable_summary=deliverable.summary if deliverable else None,
        evidence_urls=evidence_urls,
        criteria_results=criteria_results,
        submitted_at=deliverable.submitted_at if deliverable else None,
        acceptance_history=acceptance_history,
    )


def claim_task(session: Session, actor_id: int, task_id: int, payload: ClaimCreate) -> dict:
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status not in {TaskStatus.OPEN, TaskStatus.IN_PROGRESS}:
        raise HTTPException(status_code=400, detail="当前任务不可揭榜")

    lead_user_id = payload.lead_user_id or actor_id
    _ensure_user_exists(session, lead_user_id)
    _ensure_user_exists(session, actor_id)

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
        {"claim_id": claim.id, "mode": claim.mode.value},
    )
    session.commit()
    return {"claim_id": claim.id, "task_id": task_id, "status": claim.status.value}


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

    proposer_amount = round(task.reward_total * task.proposer_ratio, 2)
    executors_amount = round(task.reward_total - proposer_amount, 2)

    session.add(
        Reward(
            task_id=task.id,
            user_id=problem.submitter_id,
            role_type=RewardRoleType.PROPOSER,
            amount=proposer_amount,
        )
    )

    members = session.exec(select(ClaimMember).where(ClaimMember.claim_id == claim.id)).all()
    if not members:
        members = [ClaimMember(claim_id=claim.id, user_id=claim.lead_user_id, ratio=1.0)]
    for member in members:
        amount = round(executors_amount * member.ratio, 2)
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
            problem_summary=f"{problem.title}｜{problem.description[:120]}",
            solution_summary=f"{task.goal}｜{deliverable.summary[:200]}",
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
        task.status = TaskStatus.OPEN
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


def list_rewards(session: Session, user_id: int | None = None) -> list[RewardRead]:
    statement = select(Reward)
    if user_id is not None:
        statement = statement.where(Reward.user_id == user_id)
    rows = session.exec(statement.order_by(Reward.created_at.desc())).all()
    return [
        RewardRead(
            id=row.id,
            task_id=row.task_id,
            user_id=row.user_id,
            role_type=row.role_type.value,
            amount=row.amount,
            points=row.points,
            badge=row.badge,
            status=row.status.value,
            confirmed_at=row.confirmed_at,
        )
        for row in rows
    ]


def confirm_reward(session: Session, actor_id: int, reward_id: int) -> RewardRead:
    reward = session.get(Reward, reward_id)
    if reward is None:
        raise HTTPException(status_code=404, detail="激励记录不存在")
    reward.status = RewardStatus.CONFIRMED
    reward.confirmed_at = datetime.utcnow()
    _log(
        session,
        actor_id,
        "reward.confirm",
        "reward",
        reward_id,
        {"task_id": reward.task_id},
    )
    session.commit()
    session.refresh(reward)
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
    )


def list_knowledge(session: Session) -> list[dict]:
    rows = session.exec(select(Knowledge).order_by(Knowledge.archived_at.desc())).all()
    return [
        {
            "id": item.id,
            "task_id": item.task_id,
            "problem_summary": item.problem_summary,
            "solution_summary": item.solution_summary,
            "tags": _from_json(item.tags),
            "recommended": item.recommended,
            "archived_at": item.archived_at,
        }
        for item in rows
    ]


def release_overdue_claims(session: Session, actor_id: int | None = None) -> dict:
    today = date.today()
    claims = session.exec(select(Claim).where(Claim.status == ClaimStatus.ACTIVE)).all()
    released = 0
    for claim in claims:
        task = session.get(Task, claim.task_id)
        if task is None or task.status == TaskStatus.COMPLETED:
            continue
        if task.due_date >= today:
            continue
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
            {"task_id": task.id},
        )
    session.commit()
    return {"released_claims": released}


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

    return DashboardOverview(
        problem_total=int(problem_total),
        problem_approved=int(problem_approved),
        task_total=int(task_total),
        task_completed=int(task_completed),
        task_overdue_claims=int(task_overdue_claims),
        reward_total_confirmed_amount=float(reward_total_confirmed_amount or 0.0),
    )
