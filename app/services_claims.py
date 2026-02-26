from __future__ import annotations

from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.enums import (
    AcceptanceResult,
    ClaimApprovalStatus,
    ClaimMode,
    ClaimStatus,
    DeliverableStatus,
    Role,
    TaskStatus,
)
from app.attachments import bind_attachments
from app.models import (
    Acceptance,
    Claim,
    ClaimApprovalRequest,
    ClaimMember,
    Deliverable,
    SystemConfig,
    Task,
    User,
)
from app.schemas import (
    AcceptanceHistoryItem,
    ClaimApprovalRequestRead,
    ClaimCreate,
    ClaimExecutionDetailRead,
    ClaimExecutionRead,
    DeliverableCreate,
    PendingAcceptanceRead,
)
from app.services_common import (
    CLAIM_APPROVAL_OVERDUE_THRESHOLD_KEY,
    DEFAULT_CLAIM_APPROVAL_OVERDUE_THRESHOLD,
    MAX_ACTIVE_CLAIMS_PER_USER,
    MIN_CLAIM_APPROVAL_OVERDUE_THRESHOLD,
    _ensure_user_exists,
    _from_json_list,
    _log,
    _to_json,
)

MAX_DELIVERABLE_REWORK_ATTEMPTS = 3


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
            SystemConfig(key=CLAIM_APPROVAL_OVERDUE_THRESHOLD_KEY, value=str(value), updated_at=now)
        )
    else:
        row.value = str(value)
        row.updated_at = now
    session.commit()
    return value


def _load_claim_and_task(session: Session, claim_id: int) -> tuple[Claim, Task]:
    claim = session.get(Claim, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="claim not found")
    task = session.get(Task, claim.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
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
        raise HTTPException(status_code=403, detail="permission denied")


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
    )


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
        raise HTTPException(status_code=404, detail="task not found")
    if task.status not in {TaskStatus.OPEN, TaskStatus.IN_PROGRESS}:
        raise HTTPException(status_code=400, detail="褰撳墠浠诲姟涓嶅彲鎻")

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
        raise HTTPException(status_code=400, detail="璇ヨ礋璐ｄ汉宸叉湁杩涜涓殑鎻璁板綍")

    active_claim_count = int(
        session.exec(
            select(func.count())
            .select_from(Claim)
            .where(Claim.lead_user_id == lead_user_id, Claim.status == ClaimStatus.ACTIVE)
        ).one()
    )
    if active_claim_count >= MAX_ACTIVE_CLAIMS_PER_USER:
        raise HTTPException(
            status_code=400,
            detail=f"每人最多进行{MAX_ACTIVE_CLAIMS_PER_USER}个揭榜（each user can have at most {MAX_ACTIVE_CLAIMS_PER_USER} active claims）",
        )

    claim = Claim(task_id=task_id, lead_user_id=lead_user_id, mode=payload.mode)
    session.add(claim)
    session.flush()

    if payload.mode == ClaimMode.INDIVIDUAL:
        session.add(ClaimMember(claim_id=claim.id, user_id=lead_user_id, ratio=1.0))
    else:
        member_ids = {member.user_id for member in payload.members}
        if lead_user_id not in member_ids:
            raise HTTPException(status_code=400, detail="team members must include lead user")
        total_ratio = sum(member.ratio for member in payload.members)
        if abs(total_ratio - 1.0) > 0.01:
            raise HTTPException(status_code=400, detail=f"鍥㈤槦鎴愬憳鍒嗛厤姣斾緥涔嬪拰蹇呴』涓?.0锛屽綋鍓嶄负{total_ratio}")
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
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        text = str(exc).lower()
        if "uq_claim_task_lead_active" in text or "unique constraint failed: claim.task_id, claim.lead_user_id" in text:
            raise HTTPException(
                status_code=409,
                detail="active claim already exists for this task and lead user",
            ) from exc
        raise
    return {"claim_id": claim.id, "task_id": task_id, "status": claim.status.value}


def abandon_claim(session: Session, actor_id: int, claim_id: int) -> dict:
    _ensure_user_exists(session, actor_id)
    claim = session.get(Claim, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="claim not found")
    if claim.status not in {ClaimStatus.ACTIVE, ClaimStatus.OVERDUE}:
        raise HTTPException(status_code=400, detail="claim cannot be abandoned in current status")
    if actor_id != claim.lead_user_id:
        raise HTTPException(status_code=403, detail="浠呮彮姒滀富璐熻矗浜哄彲鏀惧純")

    task = session.get(Task, claim.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")

    was_overdue = claim.status == ClaimStatus.OVERDUE
    claim.status = ClaimStatus.ABANDONED
    active_claims = session.exec(
        select(func.count())
        .select_from(Claim)
        .where(Claim.task_id == task.id, Claim.status == ClaimStatus.ACTIVE)
    ).one()
    task.status = TaskStatus.IN_PROGRESS if int(active_claims) > 0 else TaskStatus.OPEN
    if was_overdue:
        lead = session.get(User, claim.lead_user_id)
        if lead is not None and lead.overdue_count > 0:
            lead.overdue_count -= 1

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
        raise HTTPException(status_code=404, detail="claim not found")
    if claim.status != ClaimStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="claim is not active")

    if claim.mode == ClaimMode.TEAM and actor_id != claim.lead_user_id:
        raise HTTPException(status_code=403, detail="鑱斿悎鎻浠呬富璐熻矗浜哄彲鎻愪氦鎴愭灉")
    if claim.mode == ClaimMode.INDIVIDUAL and actor_id != claim.lead_user_id:
        raise HTTPException(status_code=403, detail="only claim owner can submit deliverable")

    existing = session.exec(select(Deliverable).where(Deliverable.claim_id == claim_id)).first()
    if existing is not None and existing.status == DeliverableStatus.SUBMITTED:
        raise HTTPException(status_code=400, detail="宸叉湁寰呴獙鏀舵垚鏋滐紝涓嶈兘閲嶅鎻愪氦")

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
            uploader_user_id=actor_id,
        )
    )
    deliverable.evidence_urls = _to_json(evidence_urls)

    task = session.get(Task, claim.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
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


def accept_deliverable(
    session: Session,
    actor_id: int,
    deliverable_id: int,
    result: AcceptanceResult,
    comment: str | None,
) -> dict:
    deliverable = session.get(Deliverable, deliverable_id)
    if deliverable is None:
        raise HTTPException(status_code=404, detail="deliverable not found")

    if deliverable.status not in {DeliverableStatus.SUBMITTED, DeliverableStatus.NEEDS_REWORK}:
        raise HTTPException(status_code=400, detail="deliverable is not in an acceptable status")

    claim = session.get(Claim, deliverable.claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="claim not found")

    task = session.get(Task, claim.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")

    if actor_id != task.accepter_id:
        raise HTTPException(status_code=403, detail="only task accepter can perform acceptance")

    if actor_id == claim.lead_user_id:
        raise HTTPException(status_code=403, detail="accepter cannot accept own deliverable")

    acceptance = Acceptance(
        deliverable_id=deliverable.id,
        accepter_id=actor_id,
        result=result.value,
        comment=comment,
    )
    session.add(acceptance)

    if result == AcceptanceResult.REWORK:
        if deliverable.rework_count >= MAX_DELIVERABLE_REWORK_ATTEMPTS:
            raise HTTPException(
                status_code=400,
                detail=f"max rework attempts reached ({MAX_DELIVERABLE_REWORK_ATTEMPTS})",
            )
        deliverable.status = DeliverableStatus.NEEDS_REWORK
        deliverable.rework_count += 1
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
        # Clear other active claims under the same task to avoid hanging records.
        other_active_claims = session.exec(
            select(Claim).where(
                Claim.task_id == task.id,
                Claim.status == ClaimStatus.ACTIVE,
                Claim.id != claim.id,
            )
        ).all()
        for other_claim in other_active_claims:
            other_claim.status = ClaimStatus.ABANDONED
        from app.services_rewards import _generate_rewards_and_knowledge

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

