from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import Session, select

from app.attachments import bind_attachments
from app.enums import ClaimStatus, Role, TaskActivityType
from app.models import Claim, ClaimMember, Task, TaskActivity
from app.schemas import TaskActivityCreate, TaskActivityRead
from app.services_claims import _has_claim_access, _load_claim_and_task
from app.services_common import _from_json_dict, _from_json_list, _to_json


SYSTEM_ACTOR_USER_ID = 1


def _task_or_404(session: Session, task_id: int) -> Task:
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return task


def _claim_or_404(session: Session, claim_id: int) -> Claim:
    claim = session.get(Claim, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="claim not found")
    return claim


def _is_claim_member(session: Session, claim_id: int, user_id: int) -> bool:
    return (
        session.exec(
            select(ClaimMember).where(
                ClaimMember.claim_id == claim_id,
                ClaimMember.user_id == user_id,
            )
        ).first()
        is not None
    )


def _can_access_claim_activity(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    claim: Claim,
    task: Task,
) -> bool:
    return _has_claim_access(actor_id, actor_roles, claim, task) or _is_claim_member(session, claim.id, actor_id)


def _activity_to_read(row: TaskActivity) -> TaskActivityRead:
    return TaskActivityRead(
        id=row.id,
        task_id=row.task_id,
        claim_id=row.claim_id,
        activity_type=row.activity_type,
        actor_user_id=row.actor_user_id,
        content=row.content,
        detail=_from_json_dict(row.detail_json),
        attachment_urls=[str(item) for item in _from_json_list(row.attachment_urls)],
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
        if _can_access_claim_activity(session, actor_id, actor_roles, claim, task):
            visible_rows.append(_activity_to_read(row))
    return visible_rows


def list_claim_activities(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    claim_id: int,
) -> list[TaskActivityRead]:
    claim, task = _load_claim_and_task(session, claim_id)
    if not _can_access_claim_activity(session, actor_id, actor_roles, claim, task):
        raise HTTPException(status_code=403, detail="permission denied")
    rows = session.exec(
        select(TaskActivity)
        .where(TaskActivity.claim_id == claim_id)
        .order_by(TaskActivity.created_at.asc(), TaskActivity.id.asc())
    ).all()
    return [_activity_to_read(row) for row in rows]


def _resolve_claim_context(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    task: Task,
    payload: TaskActivityCreate,
) -> Claim | None:
    if payload.claim_id is not None:
        claim = _claim_or_404(session, payload.claim_id)
        if claim.task_id != task.id:
            raise HTTPException(status_code=400, detail="claim does not belong to task")
        return claim

    if payload.activity_type not in {TaskActivityType.PROGRESS_UPDATE, TaskActivityType.BLOCKER}:
        return None

    own_claim = session.exec(
        select(Claim)
        .where(
            Claim.task_id == task.id,
            Claim.status == ClaimStatus.ACTIVE,
            Claim.lead_user_id == actor_id,
        )
        .order_by(Claim.created_at.desc(), Claim.id.desc())
    ).first()
    if own_claim is not None:
        return own_claim

    member_claim = session.exec(
        select(Claim)
        .join(ClaimMember, ClaimMember.claim_id == Claim.id)
        .where(
            Claim.task_id == task.id,
            Claim.status == ClaimStatus.ACTIVE,
            ClaimMember.user_id == actor_id,
        )
        .order_by(Claim.created_at.desc(), Claim.id.desc())
    ).first()
    if member_claim is not None:
        return member_claim

    if actor_id == task.accepter_id or Role.ADMIN in actor_roles or Role.REVIEWER in actor_roles:
        active_claims = session.exec(
            select(Claim)
            .where(Claim.task_id == task.id, Claim.status == ClaimStatus.ACTIVE)
            .order_by(Claim.created_at.desc(), Claim.id.desc())
        ).all()
        if len(active_claims) == 1:
            return active_claims[0]
        if len(active_claims) > 1:
            raise HTTPException(status_code=400, detail="claim_id is required when multiple active claims exist")

    raise HTTPException(status_code=403, detail="permission denied")


def _ensure_activity_create_permission(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    task: Task,
    claim: Claim | None,
    payload: TaskActivityCreate,
) -> None:
    activity_type = payload.activity_type
    if activity_type == TaskActivityType.SYSTEM_EVENT:
        raise HTTPException(status_code=403, detail="system events can only be created internally")

    if activity_type == TaskActivityType.COMMENT:
        if claim is not None and not _can_access_claim_activity(session, actor_id, actor_roles, claim, task):
            raise HTTPException(status_code=403, detail="permission denied")
        return

    if activity_type in {TaskActivityType.PROGRESS_UPDATE, TaskActivityType.BLOCKER}:
        if claim is None:
            raise HTTPException(status_code=400, detail="claim context is required")
        if not _can_access_claim_activity(session, actor_id, actor_roles, claim, task):
            raise HTTPException(status_code=403, detail="permission denied")
        return

    if activity_type == TaskActivityType.OFFICIAL_NOTE:
        if Role.ADMIN not in actor_roles and Role.REVIEWER not in actor_roles:
            raise HTTPException(status_code=403, detail="permission denied")
        if claim is not None and not _can_access_claim_activity(session, actor_id, actor_roles, claim, task):
            raise HTTPException(status_code=403, detail="permission denied")
        return

    raise HTTPException(status_code=400, detail="activity type not supported")


def create_system_task_activity(
    session: Session,
    task_id: int,
    claim_id: int | None,
    content: str,
    detail: dict | None = None,
    actor_user_id: int | None = None,
) -> TaskActivity:
    row = TaskActivity(
        task_id=task_id,
        claim_id=claim_id,
        activity_type=TaskActivityType.SYSTEM_EVENT,
        actor_user_id=actor_user_id or SYSTEM_ACTOR_USER_ID,
        content=content.strip(),
        detail_json=_to_json(detail or {}),
        attachment_urls="[]",
    )
    session.add(row)
    session.flush()
    return row


def create_task_activity(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    task_id: int,
    payload: TaskActivityCreate,
) -> TaskActivityRead:
    task = _task_or_404(session, task_id)
    claim = _resolve_claim_context(session, actor_id, actor_roles, task, payload)
    _ensure_activity_create_permission(session, actor_id, actor_roles, task, claim, payload)

    row = TaskActivity(
        task_id=task_id,
        claim_id=claim.id if claim is not None else None,
        activity_type=payload.activity_type,
        actor_user_id=actor_id,
        content=payload.content.strip(),
        detail_json=_to_json(payload.detail),
        attachment_urls="[]",
    )
    session.add(row)
    session.flush()

    attachment_urls = bind_attachments(
        session=session,
        attachment_ids=payload.attachment_ids,
        entity_type="task_activity",
        entity_id=row.id,
        uploader_user_id=actor_id,
    )
    row.attachment_urls = _to_json(attachment_urls)

    session.commit()
    session.refresh(row)
    return _activity_to_read(row)


def delete_task_activity(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    activity_id: int,
) -> dict:
    row = session.get(TaskActivity, activity_id)
    if row is None:
        raise HTTPException(status_code=404, detail="activity not found")
    if row.activity_type == TaskActivityType.SYSTEM_EVENT:
        raise HTTPException(status_code=400, detail="system events cannot be deleted")
    if row.actor_user_id != actor_id and Role.ADMIN not in actor_roles:
        raise HTTPException(status_code=403, detail="permission denied")

    if row.claim_id is not None:
        claim, task = _load_claim_and_task(session, row.claim_id)
        if task.id != row.task_id:
            raise HTTPException(status_code=400, detail="activity claim/task mismatch")
        if row.actor_user_id != actor_id and not _can_access_claim_activity(session, actor_id, actor_roles, claim, task):
            raise HTTPException(status_code=403, detail="permission denied")

    session.delete(row)
    session.commit()
    return {"activity_id": activity_id, "status": "deleted"}
