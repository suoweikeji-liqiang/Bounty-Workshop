from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func
from sqlmodel import Session, select

from app.attachments import bind_attachments
from app.enums import ClaimMode, ClaimStatus, Role, TaskActivityType, TaskStatus
from app.feishu import notify_stale_progress_reminder
from app.models import Attachment, Claim, ClaimMember, Task, TaskActivity, User
from app.schemas import TaskActiveClaimRead, TaskActivityCreate, TaskActivityRead
from app.services_claims import _has_claim_access, _load_claim_and_task
from app.services_common import (
    DEFAULT_STALE_PROGRESS_REMINDER_COOLDOWN_HOURS,
    DEFAULT_STALE_PROGRESS_THRESHOLD_DAYS,
    MIN_STALE_PROGRESS_REMINDER_COOLDOWN_HOURS,
    MIN_STALE_PROGRESS_THRESHOLD_DAYS,
    _from_json_dict,
    _from_json_list,
    _to_json,
)


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


def _build_activity_view_maps(
    session: Session,
    rows: list[TaskActivity],
) -> tuple[dict[int, str], dict[int, str]]:
    user_ids = {int(row.actor_user_id) for row in rows}
    claim_ids = {int(row.claim_id) for row in rows if row.claim_id is not None}

    user_name_map: dict[int, str] = {}
    claim_name_map: dict[int, str] = {}

    if user_ids:
        user_rows = session.exec(select(User.id, User.name).where(User.id.in_(user_ids))).all()
        user_name_map = {int(user_id): user_name for user_id, user_name in user_rows}

    if claim_ids:
        claim_rows = session.exec(
            select(Claim.id, Claim.mode, User.name)
            .join(User, User.id == Claim.lead_user_id)
            .where(Claim.id.in_(claim_ids))
        ).all()
        for claim_id, claim_mode, lead_user_name in claim_rows:
            mode_label = "组队" if claim_mode == ClaimMode.TEAM else "个人"
            claim_name_map[int(claim_id)] = f"{mode_label} · {lead_user_name}"

    return user_name_map, claim_name_map


def _activity_to_read(
    row: TaskActivity,
    user_name_map: dict[int, str] | None = None,
    claim_name_map: dict[int, str] | None = None,
) -> TaskActivityRead:
    actor_user_name = user_name_map.get(int(row.actor_user_id)) if user_name_map is not None else None
    claim_name = (
        claim_name_map.get(int(row.claim_id))
        if claim_name_map is not None and row.claim_id is not None
        else None
    )
    return TaskActivityRead(
        id=row.id,
        task_id=row.task_id,
        claim_id=row.claim_id,
        activity_type=row.activity_type,
        actor_user_id=row.actor_user_id,
        actor_user_name=actor_user_name,
        claim_name=claim_name,
        content=row.content,
        detail=_from_json_dict(row.detail_json),
        attachment_urls=[str(item) for item in _from_json_list(row.attachment_urls)],
        created_at=row.created_at,
    )


def _list_task_active_claims(
    session: Session,
    task_id: int,
) -> list[TaskActiveClaimRead]:
    team_size_subquery = (
        select(ClaimMember.claim_id, func.count(ClaimMember.user_id).label("team_size"))
        .group_by(ClaimMember.claim_id)
        .subquery()
    )
    rows = session.exec(
        select(
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
        .where(
            Claim.task_id == task_id,
            Claim.status == ClaimStatus.ACTIVE,
        )
        .order_by(Claim.created_at.desc(), Claim.id.desc())
    ).all()
    return [
        TaskActiveClaimRead(
            claim_id=int(claim_id),
            mode=claim_mode,
            status=claim_status.value,
            lead_user_id=int(lead_user_id),
            lead_user_name=lead_user_name,
            team_size=max(int(team_size), 1),
            created_at=claim_created_at,
        )
        for claim_id, claim_mode, claim_status, lead_user_id, lead_user_name, team_size, claim_created_at in rows
    ]


def list_task_active_claims(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    task_id: int,
) -> list[TaskActiveClaimRead]:
    task = _task_or_404(session, task_id)
    active_claims = _list_task_active_claims(session, task_id)
    can_view_all = actor_id == task.accepter_id or Role.ADMIN in actor_roles or Role.REVIEWER in actor_roles
    if can_view_all:
        return active_claims

    lead_claim_ids = {
        int(claim_id)
        for claim_id in session.exec(
            select(Claim.id).where(
                Claim.task_id == task.id,
                Claim.status == ClaimStatus.ACTIVE,
                Claim.lead_user_id == actor_id,
            )
        ).all()
    }
    member_claim_ids = {
        int(claim_id)
        for claim_id in session.exec(
            select(Claim.id)
            .join(ClaimMember, ClaimMember.claim_id == Claim.id)
            .where(
                Claim.task_id == task.id,
                Claim.status == ClaimStatus.ACTIVE,
                ClaimMember.user_id == actor_id,
            )
        ).all()
    }
    visible_claim_ids = lead_claim_ids.union(member_claim_ids)
    return [item for item in active_claims if item.claim_id in visible_claim_ids]


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
    visible_rows: list[TaskActivity] = []
    for row in rows:
        if row.claim_id is None:
            visible_rows.append(row)
            continue
        claim = session.get(Claim, row.claim_id)
        if claim is None:
            continue
        if _can_access_claim_activity(session, actor_id, actor_roles, claim, task):
            visible_rows.append(row)
    user_name_map, claim_name_map = _build_activity_view_maps(session, visible_rows)
    return [_activity_to_read(row, user_name_map, claim_name_map) for row in visible_rows]


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
    user_name_map, claim_name_map = _build_activity_view_maps(session, rows)
    return [_activity_to_read(row, user_name_map, claim_name_map) for row in rows]


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

    member_claims = session.exec(
        select(Claim)
        .join(ClaimMember, ClaimMember.claim_id == Claim.id)
        .where(
            Claim.task_id == task.id,
            Claim.status == ClaimStatus.ACTIVE,
            ClaimMember.user_id == actor_id,
        )
        .order_by(Claim.created_at.desc(), Claim.id.desc())
    ).all()
    if len(member_claims) == 1:
        return member_claims[0]
    if len(member_claims) > 1:
        raise HTTPException(status_code=400, detail="claim_id is required when multiple active claims exist")

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
    user_name_map, claim_name_map = _build_activity_view_maps(session, [row])
    return _activity_to_read(row, user_name_map, claim_name_map)


def _latest_progress_update_at(session: Session, claim_id: int) -> datetime | None:
    return session.exec(
        select(func.max(TaskActivity.created_at)).where(
            TaskActivity.claim_id == claim_id,
            TaskActivity.activity_type == TaskActivityType.PROGRESS_UPDATE,
        )
    ).one()


def _latest_stale_reminder_at(session: Session, claim_id: int) -> datetime | None:
    rows = session.exec(
        select(TaskActivity)
        .where(
            TaskActivity.claim_id == claim_id,
            TaskActivity.activity_type == TaskActivityType.SYSTEM_EVENT,
        )
        .order_by(TaskActivity.created_at.desc(), TaskActivity.id.desc())
        .limit(30)
    ).all()
    for row in rows:
        detail = _from_json_dict(row.detail_json)
        if detail.get("event_key") == "stale_progress_reminder":
            return row.created_at
    return None


def emit_stale_progress_reminders(
    session: Session,
    actor_user_id: int | None = None,
    now: datetime | None = None,
    stale_days: int = DEFAULT_STALE_PROGRESS_THRESHOLD_DAYS,
    cooldown_hours: int = DEFAULT_STALE_PROGRESS_REMINDER_COOLDOWN_HOURS,
) -> dict:
    stale_days = max(int(stale_days), MIN_STALE_PROGRESS_THRESHOLD_DAYS)
    cooldown_hours = max(int(cooldown_hours), MIN_STALE_PROGRESS_REMINDER_COOLDOWN_HOURS)
    current_time = now or datetime.utcnow()
    stale_cutoff = current_time - timedelta(days=stale_days)
    cooldown_cutoff = current_time - timedelta(hours=cooldown_hours)

    rows = session.exec(
        select(Claim, Task)
        .join(Task, Task.id == Claim.task_id)
        .where(
            Claim.status == ClaimStatus.ACTIVE,
            Task.status != TaskStatus.COMPLETED,
        )
    ).all()

    reminder_activity_ids: list[int] = []
    notified_claim_ids: list[int] = []
    for claim, task in rows:
        last_progress_at = _latest_progress_update_at(session, claim_id=claim.id)
        reference_time = last_progress_at or claim.created_at
        if reference_time > stale_cutoff:
            continue

        last_reminder_at = _latest_stale_reminder_at(session, claim_id=claim.id)
        if last_reminder_at is not None and last_reminder_at > cooldown_cutoff:
            continue

        activity = create_system_task_activity(
            session=session,
            task_id=task.id,
            claim_id=claim.id,
            content=f"No progress update for {stale_days} days. Please post an update.",
            detail={
                "event_key": "stale_progress_reminder",
                "stale_days": stale_days,
                "last_progress_at": last_progress_at.isoformat() if last_progress_at is not None else None,
                "lead_user_id": claim.lead_user_id,
            },
            actor_user_id=actor_user_id,
        )
        reminder_activity_ids.append(activity.id)
        notify_stale_progress_reminder(
            session=session,
            task_id=task.id,
            claim_id=claim.id,
            lead_user_id=claim.lead_user_id,
            accepter_user_id=task.accepter_id,
            stale_days=stale_days,
            last_progress_at=last_progress_at,
        )
        notified_claim_ids.append(claim.id)

    if reminder_activity_ids:
        session.commit()

    return {
        "checked_claims": len(rows),
        "reminders_created": len(reminder_activity_ids),
        "reminder_activity_ids": reminder_activity_ids,
        "notified_claim_ids": notified_claim_ids,
        "stale_days": stale_days,
        "cooldown_hours": cooldown_hours,
    }


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

    bound_attachments = session.exec(
        select(Attachment).where(
            Attachment.entity_type == "task_activity",
            Attachment.entity_id == activity_id,
        )
    ).all()
    for attachment in bound_attachments:
        attachment.entity_type = None
        attachment.entity_id = None

    session.delete(row)
    session.commit()
    return {"activity_id": activity_id, "status": "deleted"}
