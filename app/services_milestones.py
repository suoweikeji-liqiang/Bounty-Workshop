from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlmodel import Session, select

from app.attachments import bind_attachments
from app.enums import (
    ClaimMode,
    ClaimStatus,
    MilestoneAcceptanceResult,
    MilestoneStatus,
    Role,
)
from app.models import (
    Claim,
    ClaimMember,
    MilestoneAcceptance,
    MilestoneSubmission,
    Problem,
    Task,
    TaskMilestone,
)
from app.schemas import (
    MilestoneAcceptanceCreate,
    MilestonePendingAcceptanceRead,
    MilestoneSubmissionCreate,
    MilestoneSubmissionRead,
    TaskMilestoneCreate,
    TaskMilestoneRead,
    TaskMilestoneUpdate,
)
from app.services_common import _from_json_list, _to_json


def _task_or_404(session: Session, task_id: int) -> Task:
    row = session.get(Task, task_id)
    if row is None:
        raise HTTPException(status_code=404, detail="task not found")
    return row


def _milestone_or_404(session: Session, milestone_id: int) -> TaskMilestone:
    row = session.get(TaskMilestone, milestone_id)
    if row is None:
        raise HTTPException(status_code=404, detail="milestone not found")
    return row


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


def _latest_submission(session: Session, milestone_id: int) -> MilestoneSubmission | None:
    return session.exec(
        select(MilestoneSubmission)
        .where(MilestoneSubmission.milestone_id == milestone_id)
        .order_by(MilestoneSubmission.submitted_at.desc(), MilestoneSubmission.id.desc())
    ).first()


def _submission_to_read(row: MilestoneSubmission) -> MilestoneSubmissionRead:
    return MilestoneSubmissionRead(
        id=row.id,
        milestone_id=row.milestone_id,
        claim_id=row.claim_id,
        summary=row.summary,
        evidence_urls=[str(item) for item in _from_json_list(row.evidence_urls)],
        criteria_results=[str(item) for item in _from_json_list(row.criteria_results_json)],
        submitted_by_user_id=row.submitted_by_user_id,
        submitted_at=row.submitted_at,
    )


def _milestone_to_read(session: Session, row: TaskMilestone) -> TaskMilestoneRead:
    latest = _latest_submission(session, row.id)
    return TaskMilestoneRead(
        id=row.id,
        task_id=row.task_id,
        sequence=row.sequence,
        title=row.title,
        goal=row.goal,
        due_date=row.due_date,
        acceptance_criteria=_from_json_list(row.acceptance_criteria_json),
        reward_ratio=row.reward_ratio,
        status=row.status,
        latest_submission=_submission_to_read(latest) if latest is not None else None,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _validate_milestone_payloads(task: Task, payloads: list[TaskMilestoneCreate]) -> list[TaskMilestoneCreate]:
    if not task.is_complex:
        raise HTTPException(status_code=400, detail="simple tasks do not support milestones")
    if not (2 <= len(payloads) <= 5):
        raise HTTPException(status_code=400, detail="complex tasks must define 2-5 milestones")
    ordered = sorted(payloads, key=lambda item: item.sequence)
    for index, item in enumerate(ordered, start=1):
        if item.sequence != index:
            raise HTTPException(status_code=400, detail="milestone sequence must start at 1 and be continuous")
        if not item.acceptance_criteria:
            raise HTTPException(status_code=400, detail="milestone acceptance criteria is required")
    ratio_total = sum(item.reward_ratio for item in ordered) + task.closing_reward_ratio
    if abs(ratio_total - 1.0) > 1e-6:
        raise HTTPException(status_code=400, detail="milestone ratios plus closing ratio must equal 1")
    return ordered


def list_task_milestones(
    session: Session,
    task_id: int,
) -> list[TaskMilestoneRead]:
    _task_or_404(session, task_id)
    rows = session.exec(
        select(TaskMilestone)
        .where(TaskMilestone.task_id == task_id)
        .order_by(TaskMilestone.sequence.asc(), TaskMilestone.id.asc())
    ).all()
    return [_milestone_to_read(session, row) for row in rows]


def configure_task_milestones(
    session: Session,
    actor_roles: set[Role],
    task_id: int,
    payloads: list[TaskMilestoneCreate],
) -> list[TaskMilestoneRead]:
    if Role.ADMIN not in actor_roles and Role.REVIEWER not in actor_roles:
        raise HTTPException(status_code=403, detail="permission denied")
    task = _task_or_404(session, task_id)
    ordered = _validate_milestone_payloads(task, payloads)

    existing_claim = session.exec(select(Claim).where(Claim.task_id == task_id)).first()
    if existing_claim is not None:
        raise HTTPException(status_code=400, detail="cannot reconfigure milestones after claims are created")

    existing_rows = session.exec(select(TaskMilestone).where(TaskMilestone.task_id == task_id)).all()
    for row in existing_rows:
        session.delete(row)

    for item in ordered:
        session.add(
            TaskMilestone(
                task_id=task_id,
                sequence=item.sequence,
                title=item.title,
                goal=item.goal,
                due_date=item.due_date,
                acceptance_criteria_json=_to_json([criterion.model_dump() for criterion in item.acceptance_criteria]),
                reward_ratio=item.reward_ratio,
                status=MilestoneStatus.PENDING,
            )
        )
    session.commit()
    return list_task_milestones(session, task_id=task_id)


def update_task_milestone(
    session: Session,
    actor_roles: set[Role],
    milestone_id: int,
    payload: TaskMilestoneUpdate,
) -> TaskMilestoneRead:
    if Role.ADMIN not in actor_roles and Role.REVIEWER not in actor_roles:
        raise HTTPException(status_code=403, detail="permission denied")
    milestone = _milestone_or_404(session, milestone_id)

    if payload.title is not None:
        milestone.title = payload.title
    if payload.goal is not None:
        milestone.goal = payload.goal
    if payload.due_date is not None:
        milestone.due_date = payload.due_date
    if payload.acceptance_criteria is not None:
        if not payload.acceptance_criteria:
            raise HTTPException(status_code=400, detail="milestone acceptance criteria is required")
        milestone.acceptance_criteria_json = _to_json([item.model_dump() for item in payload.acceptance_criteria])
    if payload.reward_ratio is not None:
        milestone.reward_ratio = payload.reward_ratio
    if payload.status is not None:
        milestone.status = payload.status

    # Keep ratio totals consistent with task closing ratio.
    all_rows = session.exec(select(TaskMilestone).where(TaskMilestone.task_id == milestone.task_id)).all()
    task = _task_or_404(session, milestone.task_id)
    total = sum(item.reward_ratio for item in all_rows) + task.closing_reward_ratio
    if abs(total - 1.0) > 1e-6:
        raise HTTPException(status_code=400, detail="milestone ratios plus closing ratio must equal 1")

    milestone.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(milestone)
    return _milestone_to_read(session, milestone)


def activate_first_milestone_for_task(session: Session, task_id: int) -> None:
    task = session.get(Task, task_id)
    if task is None or not task.is_complex:
        return
    rows = session.exec(
        select(TaskMilestone)
        .where(TaskMilestone.task_id == task_id)
        .order_by(TaskMilestone.sequence.asc(), TaskMilestone.id.asc())
    ).all()
    if not rows:
        return
    active_count = len([item for item in rows if item.status in {MilestoneStatus.ACTIVE, MilestoneStatus.PENDING_ACCEPTANCE}])
    if active_count > 0:
        return
    for item in rows:
        if item.status in {MilestoneStatus.PENDING, MilestoneStatus.REWORK}:
            item.status = MilestoneStatus.ACTIVE
            item.updated_at = datetime.utcnow()
            break


def all_task_milestones_approved(session: Session, task_id: int) -> bool:
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    if not task.is_complex:
        return True
    rows = session.exec(select(TaskMilestone).where(TaskMilestone.task_id == task_id)).all()
    if not rows:
        return False
    return all(item.status == MilestoneStatus.APPROVED for item in rows)


def _resolve_submission_claim(
    session: Session,
    actor_id: int,
    task: Task,
    payload: MilestoneSubmissionCreate,
) -> Claim:
    if payload.claim_id is not None:
        claim = session.get(Claim, payload.claim_id)
        if claim is None:
            raise HTTPException(status_code=404, detail="claim not found")
        if claim.task_id != task.id:
            raise HTTPException(status_code=400, detail="claim does not belong to task")
        return claim

    active_claims = session.exec(
        select(Claim).where(Claim.task_id == task.id, Claim.status == ClaimStatus.ACTIVE)
    ).all()
    own_claims = [
        item
        for item in active_claims
        if item.lead_user_id == actor_id or _is_claim_member(session, item.id, actor_id)
    ]
    if len(own_claims) == 1:
        return own_claims[0]
    if len(own_claims) > 1:
        raise HTTPException(status_code=400, detail="claim_id is required when multiple active claims exist")
    raise HTTPException(status_code=403, detail="permission denied")


def submit_milestone(
    session: Session,
    actor_id: int,
    milestone_id: int,
    payload: MilestoneSubmissionCreate,
) -> TaskMilestoneRead:
    milestone = _milestone_or_404(session, milestone_id)
    task = _task_or_404(session, milestone.task_id)
    if not task.is_complex:
        raise HTTPException(status_code=400, detail="simple tasks do not support milestones")
    if milestone.status not in {MilestoneStatus.ACTIVE, MilestoneStatus.REWORK}:
        raise HTTPException(status_code=400, detail="milestone is not accepting submissions")

    claim = _resolve_submission_claim(session, actor_id, task, payload)
    if claim.status != ClaimStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="claim is not active")
    if claim.mode == ClaimMode.INDIVIDUAL and actor_id != claim.lead_user_id:
        raise HTTPException(status_code=403, detail="only claim owner can submit milestone output")
    if claim.mode == ClaimMode.TEAM and actor_id != claim.lead_user_id and not _is_claim_member(session, claim.id, actor_id):
        raise HTTPException(status_code=403, detail="permission denied")

    evidence_urls = list(payload.evidence_urls)
    submission = MilestoneSubmission(
        milestone_id=milestone.id,
        claim_id=claim.id,
        summary=payload.summary,
        evidence_urls="[]",
        criteria_results_json=_to_json(payload.criteria_results),
        submitted_by_user_id=actor_id,
    )
    session.add(submission)
    session.flush()
    evidence_urls.extend(
        bind_attachments(
            session=session,
            attachment_ids=payload.evidence_attachment_ids,
            entity_type="milestone_submission",
            entity_id=submission.id,
            uploader_user_id=actor_id,
        )
    )
    submission.evidence_urls = _to_json(evidence_urls)

    milestone.status = MilestoneStatus.PENDING_ACCEPTANCE
    milestone.updated_at = datetime.utcnow()

    from app.services_task_activity import create_system_task_activity

    create_system_task_activity(
        session=session,
        task_id=task.id,
        claim_id=claim.id,
        content=f"Milestone {milestone.sequence} submitted for acceptance.",
        detail={"event_key": "milestone_submitted", "milestone_id": milestone.id, "submission_id": submission.id},
        actor_user_id=actor_id,
    )
    session.commit()
    session.refresh(milestone)
    return _milestone_to_read(session, milestone)


def _activate_next_milestone(session: Session, task_id: int, current_sequence: int) -> int | None:
    next_row = session.exec(
        select(TaskMilestone)
        .where(
            TaskMilestone.task_id == task_id,
            TaskMilestone.sequence > current_sequence,
        )
        .order_by(TaskMilestone.sequence.asc())
    ).first()
    if next_row is None:
        return None
    next_row.status = MilestoneStatus.ACTIVE
    next_row.updated_at = datetime.utcnow()
    return next_row.id


def accept_milestone(
    session: Session,
    actor_id: int,
    milestone_id: int,
    payload: MilestoneAcceptanceCreate,
) -> dict:
    milestone = _milestone_or_404(session, milestone_id)
    task = _task_or_404(session, milestone.task_id)
    if actor_id != task.accepter_id:
        raise HTTPException(status_code=403, detail="only task accepter can perform milestone acceptance")
    if milestone.status != MilestoneStatus.PENDING_ACCEPTANCE:
        raise HTTPException(status_code=400, detail="milestone is not pending acceptance")

    submission = _latest_submission(session, milestone.id)
    if submission is None:
        raise HTTPException(status_code=400, detail="milestone has no submission")
    if submission.submitted_by_user_id == actor_id:
        raise HTTPException(status_code=403, detail="accepter cannot accept own milestone output")

    acceptance = MilestoneAcceptance(
        milestone_id=milestone.id,
        submission_id=submission.id,
        accepter_id=actor_id,
        result=payload.result,
        comment=payload.comment,
    )
    session.add(acceptance)

    next_milestone_id: int | None = None
    if payload.result == MilestoneAcceptanceResult.APPROVED:
        milestone.status = MilestoneStatus.APPROVED
        from app.services_rewards import create_milestone_reward_holds

        claim = session.get(Claim, submission.claim_id)
        if claim is None:
            raise HTTPException(status_code=404, detail="claim not found")
        problem = session.get(Problem, task.problem_id)
        if problem is None:
            raise HTTPException(status_code=404, detail="problem not found")
        create_milestone_reward_holds(
            session=session,
            task=task,
            claim=claim,
            milestone=milestone,
            proposer_user_id=problem.submitter_id,
        )
        next_milestone_id = _activate_next_milestone(session, task_id=task.id, current_sequence=milestone.sequence)
    elif payload.result == MilestoneAcceptanceResult.REWORK:
        milestone.status = MilestoneStatus.REWORK
    else:
        milestone.status = MilestoneStatus.CANCELLED

    milestone.updated_at = datetime.utcnow()
    from app.services_task_activity import create_system_task_activity

    create_system_task_activity(
        session=session,
        task_id=task.id,
        claim_id=submission.claim_id,
        content=f"Milestone {milestone.sequence} acceptance result: {payload.result.value}.",
        detail={
            "event_key": "milestone_accepted",
            "milestone_id": milestone.id,
            "submission_id": submission.id,
            "result": payload.result.value,
            "next_milestone_id": next_milestone_id,
        },
        actor_user_id=actor_id,
    )
    session.commit()
    return {
        "milestone_id": milestone.id,
        "result": payload.result.value,
        "status": milestone.status.value,
        "next_milestone_id": next_milestone_id,
    }


def list_my_pending_milestone_acceptance(
    session: Session,
    user_id: int,
) -> list[MilestonePendingAcceptanceRead]:
    rows = session.exec(
        select(TaskMilestone, Task)
        .join(Task, Task.id == TaskMilestone.task_id)
        .where(
            Task.accepter_id == user_id,
            TaskMilestone.status == MilestoneStatus.PENDING_ACCEPTANCE,
        )
        .order_by(TaskMilestone.updated_at.desc(), TaskMilestone.id.desc())
    ).all()
    output: list[MilestonePendingAcceptanceRead] = []
    for milestone, task in rows:
        submission = _latest_submission(session, milestone.id)
        if submission is None:
            continue
        output.append(
            MilestonePendingAcceptanceRead(
                milestone_id=milestone.id,
                task_id=task.id,
                task_title=task.title,
                sequence=milestone.sequence,
                claim_id=submission.claim_id,
                submitted_at=submission.submitted_at,
                submitted_by_user_id=submission.submitted_by_user_id,
                status=milestone.status,
            )
        )
    return output

