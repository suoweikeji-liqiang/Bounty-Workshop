from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.auth import get_current_user_id
from app.db import get_session
from app.enums import Scenario, TaskLevel, TaskStatus
from app.schemas import TaskDetailRead, TaskRead
from app.services import get_task_detail, list_tasks

router = APIRouter(tags=["tasks"])


@router.get("/tasks", response_model=list[TaskRead])
def get_tasks(
    status: TaskStatus | None = Query(default=None),
    level: TaskLevel | None = Query(default=None),
    scenario: Scenario | None = Query(default=None),
    reward_min: float | None = Query(default=None),
    reward_max: float | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=200),
    session: Session = Depends(get_session),
    _: int = Depends(get_current_user_id),
) -> list[TaskRead]:
    return list_tasks(
        session,
        status=status,
        level=level,
        scenario=scenario,
        reward_min=reward_min,
        reward_max=reward_max,
        offset=offset,
        limit=limit,
    )


@router.get("/tasks/{task_id}", response_model=TaskDetailRead)
def get_task(
    task_id: int,
    session: Session = Depends(get_session),
    _: int = Depends(get_current_user_id),
) -> TaskDetailRead:
    return get_task_detail(session, task_id=task_id)
