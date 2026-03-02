from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func
from sqlmodel import Session, select

from app.enums import ClaimStatus, ProblemStatus, Scenario, TaskLevel, TaskStatus
from app.models import Claim, Problem, Task
from app.schemas import TaskDetailRead, TaskRead
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
            is_complex=task.is_complex,
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
        is_complex=task.is_complex,
        acceptance_criteria=acceptance_criteria,
        status=task.status.value,
        created_at=task.created_at,
    )
