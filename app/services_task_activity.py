from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import Session, select

from app.enums import ClaimStatus, Role, TaskActivityType
from app.models import Claim, Task, TaskActivity
from app.schemas import TaskActivityCreate, TaskActivityRead
from app.services_claims import _ensure_claim_access, _has_claim_access, _load_claim_and_task


def _task_or_404(session: Session, task_id: int) -> Task:
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return task


def _activity_to_read(row: TaskActivity) -> TaskActivityRead:
    return TaskActivityRead(
        id=row.id,
        task_id=row.task_id,
        claim_id=row.claim_id,
        activity_type=row.activity_type,
        actor_user_id=row.actor_user_id,
        content=row.content,
        created_at=row.created_at,
    )


def list_task_activities(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    task_id: int,
) -> list[TaskActivityRead]:
    task = _task_or_404(session, task_id)
    rows = session.exec(
        select(TaskActivity)
        .where(TaskActivity.task_id == task_id)
        .order_by(TaskActivity.created_at.asc(), TaskActivity.id.asc())
    ).all()
    visible_rows: list[TaskActivityRead] = []
    for row in rows:
        if row.claim_id is None:
            visible_rows.append(_activity_to_read(row))
            continue
        claim = session.get(Claim, row.claim_id)
        if claim is None:
            continue
        if _has_claim_access(actor_id, actor_roles, claim, task):
            visible_rows.append(_activity_to_read(row))
    return visible_rows


def list_claim_activities(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    claim_id: int,
) -> list[TaskActivityRead]:
    claim, task = _load_claim_and_task(session, claim_id)
    _ensure_claim_access(actor_id, actor_roles, claim, task)
    rows = session.exec(
        select(TaskActivity)
        .where(TaskActivity.claim_id == claim_id)
        .order_by(TaskActivity.created_at.asc(), TaskActivity.id.asc())
    ).all()
    return [_activity_to_read(row) for row in rows]


def create_task_activity(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    task_id: int,
    payload: TaskActivityCreate,
) -> TaskActivityRead:
    claim_id: int | None = None
    if payload.activity_type == TaskActivityType.COMMENT:
        _task_or_404(session, task_id)
    elif payload.activity_type == TaskActivityType.PROGRESS_UPDATE:
        _task_or_404(session, task_id)
        active_claim = session.exec(
            select(Claim).where(
                Claim.task_id == task_id,
                Claim.lead_user_id == actor_id,
                Claim.status == ClaimStatus.ACTIVE,
            )
        ).first()
        if active_claim is None:
            raise HTTPException(status_code=403, detail="permission denied")
        claim_id = active_claim.id
    else:
        raise HTTPException(status_code=400, detail="activity type not supported")

    row = TaskActivity(
        task_id=task_id,
        claim_id=claim_id,
        activity_type=payload.activity_type,
        actor_user_id=actor_id,
        content=payload.content.strip(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _activity_to_read(row)
