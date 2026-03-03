from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import func
from sqlmodel import Session, select

from app.enums import ClaimStatus, Scenario, TaskLevel, TaskStatus
from app.models import Claim, ClaimMember, Problem, Task, User
from app.schemas import TaskActiveClaimRead, TaskDetailRead, TaskRead
from app.services_common import _from_json_list


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
    active_claim_map: dict[int, list[TaskActiveClaimRead]] = {}
    if task_ids:
        team_size_subquery = (
            select(ClaimMember.claim_id, func.count(ClaimMember.user_id).label("team_size"))
            .group_by(ClaimMember.claim_id)
            .subquery()
        )
        claim_rows = session.exec(
            select(
                Claim.task_id,
                Claim.id,
                Claim.mode,
                Claim.status,
                Claim.lead_user_id,
                User.name,
                func.coalesce(team_size_subquery.c.team_size, 1),
                Claim.created_at,
            )
            .join(User, User.id == Claim.lead_user_id)
            .outerjoin(team_size_subquery, team_size_subquery.c.claim_id == Claim.id)
            .where(Claim.task_id.in_(task_ids), Claim.status == ClaimStatus.ACTIVE)
            .order_by(Claim.task_id.asc(), Claim.created_at.desc(), Claim.id.desc())
        ).all()
        for (
            task_id,
            claim_id,
            claim_mode,
            claim_status,
            lead_user_id,
            lead_user_name,
            team_size,
            claim_created_at,
        ) in claim_rows:
            active_claim_map.setdefault(int(task_id), []).append(
                TaskActiveClaimRead(
                    claim_id=int(claim_id),
                    mode=claim_mode,
                    status=claim_status.value,
                    lead_user_id=int(lead_user_id),
                    lead_user_name=lead_user_name,
                    team_size=max(int(team_size), 1),
                    created_at=claim_created_at,
                )
            )

    return [
        TaskRead(
            id=task.id,
            problem_id=task.problem_id,
            title=task.title,
            scenario=task_scenario,
            level=task.level,
            reward_total=task.reward_total,
            is_complex=task.is_complex,
            active_claim_count=len(active_claim_map.get(task.id, [])),
            active_claims=active_claim_map.get(task.id, []),
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
        is_complex=task.is_complex,
        closing_reward_ratio=task.closing_reward_ratio,
        acceptance_criteria=acceptance_criteria,
        status=task.status.value,
        created_at=task.created_at,
    )
