from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.auth import get_current_user_id, get_user_roles
from app.db import get_session
from app.schemas import (
    MilestoneAcceptanceCreate,
    MilestonePendingAcceptanceRead,
    MilestoneSubmissionCreate,
    TaskMilestoneCreate,
    TaskMilestoneRead,
    TaskMilestoneUpdate,
)
from app.services import (
    accept_milestone,
    configure_task_milestones,
    list_my_pending_milestone_acceptance,
    list_task_milestones,
    submit_milestone,
    update_task_milestone,
)

router = APIRouter(tags=["milestones"])


@router.get("/tasks/{task_id}/milestones", response_model=list[TaskMilestoneRead])
def get_task_milestones(
    task_id: int,
    session: Session = Depends(get_session),
    _: int = Depends(get_current_user_id),
) -> list[TaskMilestoneRead]:
    return list_task_milestones(session, task_id=task_id)


@router.post("/tasks/{task_id}/milestones", response_model=list[TaskMilestoneRead])
def post_task_milestones(
    task_id: int,
    payload: list[TaskMilestoneCreate],
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> list[TaskMilestoneRead]:
    actor_roles = get_user_roles(session, actor_id)
    return configure_task_milestones(session, actor_roles=actor_roles, task_id=task_id, payloads=payload)


@router.put("/milestones/{milestone_id}", response_model=TaskMilestoneRead)
def put_task_milestone(
    milestone_id: int,
    payload: TaskMilestoneUpdate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> TaskMilestoneRead:
    actor_roles = get_user_roles(session, actor_id)
    return update_task_milestone(session, actor_roles=actor_roles, milestone_id=milestone_id, payload=payload)


@router.post("/milestones/{milestone_id}/submit", response_model=TaskMilestoneRead)
def post_submit_milestone(
    milestone_id: int,
    payload: MilestoneSubmissionCreate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> TaskMilestoneRead:
    return submit_milestone(session, actor_id=actor_id, milestone_id=milestone_id, payload=payload)


@router.post("/milestones/{milestone_id}/accept")
def post_accept_milestone(
    milestone_id: int,
    payload: MilestoneAcceptanceCreate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    return accept_milestone(session, actor_id=actor_id, milestone_id=milestone_id, payload=payload)


@router.get("/milestones/pending-acceptance/mine", response_model=list[MilestonePendingAcceptanceRead])
def get_my_pending_milestones(
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> list[MilestonePendingAcceptanceRead]:
    return list_my_pending_milestone_acceptance(session, user_id=actor_id)

