from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.auth import get_current_user_id, get_user_roles
from app.db import get_session
from app.schemas import TaskActivityCreate, TaskActivityRead
from app.services import (
    create_task_activity,
    delete_task_activity,
    list_claim_activities,
    list_task_activities,
)

router = APIRouter(tags=["task-activities"])


@router.get("/tasks/{task_id}/activities", response_model=list[TaskActivityRead])
def get_task_activities(
    task_id: int,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> list[TaskActivityRead]:
    actor_roles = get_user_roles(session, actor_id)
    return list_task_activities(session, actor_id=actor_id, actor_roles=actor_roles, task_id=task_id)


@router.post("/tasks/{task_id}/activities", response_model=TaskActivityRead)
def post_task_activity(
    task_id: int,
    payload: TaskActivityCreate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> TaskActivityRead:
    actor_roles = get_user_roles(session, actor_id)
    return create_task_activity(
        session,
        actor_id=actor_id,
        actor_roles=actor_roles,
        task_id=task_id,
        payload=payload,
    )


@router.get("/claims/{claim_id}/activities", response_model=list[TaskActivityRead])
def get_claim_activities(
    claim_id: int,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> list[TaskActivityRead]:
    actor_roles = get_user_roles(session, actor_id)
    return list_claim_activities(session, actor_id=actor_id, actor_roles=actor_roles, claim_id=claim_id)


@router.delete("/activities/{activity_id}")
def delete_activity(
    activity_id: int,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    actor_roles = get_user_roles(session, actor_id)
    return delete_task_activity(session, actor_id=actor_id, actor_roles=actor_roles, activity_id=activity_id)
