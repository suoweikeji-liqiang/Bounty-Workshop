from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import update
from sqlmodel import Session, select

from app.enums import AnalysisStatus, HypothesisStatus, ProblemStatus, Role, Scenario, TaskStatus
from app.attachments import bind_attachments
from app.models import (
    HypothesisVerification,
    Problem,
    ProblemAnalysis,
    ProblemReviewAnalysisRef,
    Task,
    User,
)
from app.prodmind import run_analysis as run_prodmind_analysis
from app.schemas import ProblemCreate, ProblemDetailRead, ProblemRead, ProblemReview, TaskRead
from app.services_common import _ensure_role, _ensure_user_exists, _from_json_list, _log, _to_json


def _problem_to_read(problem: Problem) -> ProblemRead:
    return ProblemRead(
        id=problem.id,
        title=problem.title,
        scenario=problem.scenario,
        status=problem.status,
        reject_reason=problem.reject_reason,
        merged_problem_id=problem.merged_problem_id,
        submitter_id=problem.submitter_id,
        created_at=problem.created_at,
    )


def _problem_to_detail(problem: Problem) -> ProblemDetailRead:
    return ProblemDetailRead(
        id=problem.id,
        title=problem.title,
        scenario=problem.scenario,
        background=problem.background,
        frequency=problem.frequency,
        impact_scope=problem.impact_scope,
        description=problem.description,
        value_reduce_effort=problem.value_reduce_effort,
        value_reduce_cost=problem.value_reduce_cost,
        value_improve_quality=problem.value_improve_quality,
        value_statement=problem.value_statement,
        current_solution=problem.current_solution,
        attachment_urls=[str(item) for item in _from_json_list(problem.attachment_urls)],
        status=problem.status,
        reject_reason=problem.reject_reason,
        merged_problem_id=problem.merged_problem_id,
        submitter_id=problem.submitter_id,
        created_at=problem.created_at,
    )


def create_problem(session: Session, actor_id: int, payload: ProblemCreate) -> ProblemRead:
    _ensure_user_exists(session, actor_id)
    attachment_urls = list(payload.attachment_urls)
    problem = Problem(
        title=payload.title,
        scenario=payload.scenario,
        background=payload.background,
        frequency=payload.frequency,
        impact_scope=payload.impact_scope,
        description=payload.description,
        value_reduce_effort=payload.value_reduce_effort,
        value_reduce_cost=payload.value_reduce_cost,
        value_improve_quality=payload.value_improve_quality,
        value_statement=payload.value_statement,
        current_solution=payload.current_solution,
        attachment_urls="[]",
        submitter_id=actor_id,
    )
    session.add(problem)
    session.flush()
    attachment_urls.extend(
        bind_attachments(
            session=session,
            attachment_ids=payload.attachment_ids,
            entity_type="problem",
            entity_id=problem.id,
            uploader_user_id=actor_id,
        )
    )
    problem.attachment_urls = _to_json(attachment_urls)
    _log(
        session=session,
        actor_user_id=actor_id,
        action="problem.create",
        target_type="problem",
        target_id=problem.id,
        detail={"title": payload.title},
    )
    session.commit()
    return _problem_to_read(problem)


def get_problem_detail(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    problem_id: int,
) -> ProblemDetailRead:
    problem = session.get(Problem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="问题不存在")
    if (
        problem.submitter_id != actor_id
        and Role.ADMIN not in actor_roles
        and Role.REVIEWER not in actor_roles
    ):
        raise HTTPException(status_code=403, detail="无权查看该问题详情")
    return _problem_to_detail(problem)


def resubmit_problem(
    session: Session,
    actor_id: int,
    problem_id: int,
    payload: ProblemCreate,
) -> ProblemRead:
    problem = session.get(Problem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="问题不存在")
    if problem.submitter_id != actor_id:
        raise HTTPException(status_code=403, detail="仅问题提交人可修改重提")
    if problem.status != ProblemStatus.REJECTED:
        raise HTTPException(status_code=400, detail="仅驳回问题可修改重提")

    attachment_urls = _from_json_list(problem.attachment_urls)
    attachment_urls.extend(payload.attachment_urls)
    attachment_urls.extend(
        bind_attachments(
            session=session,
            attachment_ids=payload.attachment_ids,
            entity_type="problem",
            entity_id=problem.id,
            uploader_user_id=actor_id,
        )
    )

    problem.title = payload.title
    problem.scenario = payload.scenario
    problem.background = payload.background
    problem.frequency = payload.frequency
    problem.impact_scope = payload.impact_scope
    problem.description = payload.description
    problem.value_reduce_effort = payload.value_reduce_effort
    problem.value_reduce_cost = payload.value_reduce_cost
    problem.value_improve_quality = payload.value_improve_quality
    problem.value_statement = payload.value_statement
    problem.current_solution = payload.current_solution
    problem.attachment_urls = _to_json(list(dict.fromkeys(str(item) for item in attachment_urls)))
    problem.status = ProblemStatus.PENDING_REVIEW
    problem.reject_reason = None
    problem.merged_problem_id = None
    problem.analysis_id = None
    problem.analysis_status = AnalysisStatus.PENDING

    _log(
        session=session,
        actor_user_id=actor_id,
        action="problem.resubmit",
        target_type="problem",
        target_id=problem.id,
        detail={"title": problem.title},
    )
    session.commit()
    session.refresh(problem)
    return _problem_to_read(problem)


def list_problems(
    session: Session,
    user_id: int,
    mine_only: bool = False,
    status: ProblemStatus | None = None,
    scenario: Scenario | None = None,
    created_from: date | None = None,
    created_to: date | None = None,
    offset: int = 0,
    limit: int = 200,
) -> list[ProblemRead]:
    statement = select(Problem)
    if mine_only:
        statement = statement.where(Problem.submitter_id == user_id)
    if status is not None:
        statement = statement.where(Problem.status == status)
    if scenario is not None:
        statement = statement.where(Problem.scenario == scenario)
    if created_from is not None:
        statement = statement.where(
            Problem.created_at >= datetime.combine(created_from, datetime.min.time())
        )
    if created_to is not None:
        statement = statement.where(
            Problem.created_at < datetime.combine(created_to + timedelta(days=1), datetime.min.time())
        )
    safe_offset = max(offset, 0)
    safe_limit = max(1, min(limit, 200))
    problems = session.exec(
        statement.order_by(Problem.created_at.desc()).offset(safe_offset).limit(safe_limit)
    ).all()
    return [_problem_to_read(item) for item in problems]


def review_problem(session: Session, actor_id: int, problem_id: int, payload: ProblemReview) -> TaskRead | None:
    problem = session.get(Problem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="问题不存在")

    if not payload.approve:
        updated = session.exec(
            update(Problem)
            .where(Problem.id == problem_id, Problem.status == ProblemStatus.PENDING_REVIEW)
            .values(
                status=ProblemStatus.REJECTED,
                reject_reason=payload.reject_reason,
                merged_problem_id=payload.merge_to_problem_id,
            )
        )
        if (updated.rowcount or 0) < 1:
            raise HTTPException(status_code=409, detail="problem already reviewed")
        _log(
            session,
            actor_id,
            "problem.reject",
            "problem",
            problem_id,
            {"reason": payload.reject_reason, "merge_to": payload.merge_to_problem_id},
        )
        session.commit()
        return None

    if payload.analysis_id:
        analysis = session.get(ProblemAnalysis, payload.analysis_id)
        if analysis is None:
            raise HTTPException(status_code=400, detail="论证记录不存在")
        if analysis.problem_id != problem_id:
            raise HTTPException(status_code=400, detail="论证记录不属于当前问题")
        ref = ProblemReviewAnalysisRef(
            problem_id=problem_id,
            recommendation=analysis.recommendation or "中立",
            analysis_id=payload.analysis_id,
            acceptance_reason=payload.analysis_acceptance,
            reviewed_by=actor_id,
        )
        session.add(ref)
        _log(
            session,
            actor_id,
            "problem.analysis_ref.created",
            "problem",
            problem_id,
            {"analysis_id": payload.analysis_id, "acceptance": payload.analysis_acceptance},
        )

    assert payload.task is not None
    _ensure_role(session, payload.task.accepter_id, Role.ACCEPTOR)

    updated = session.exec(
        update(Problem)
        .where(Problem.id == problem_id, Problem.status == ProblemStatus.PENDING_REVIEW)
        .values(
            status=ProblemStatus.APPROVED,
            reject_reason=None,
            merged_problem_id=None,
        )
    )
    if (updated.rowcount or 0) < 1:
        raise HTTPException(status_code=409, detail="problem already reviewed")

    task = Task(
        problem_id=problem.id,
        title=payload.task.title,
        goal=payload.task.goal,
        scope=payload.task.scope,
        due_date=payload.task.due_date,
        level=payload.task.level,
        reward_total=payload.task.reward_total,
        proposer_ratio=payload.task.proposer_ratio,
        accepter_id=payload.task.accepter_id,
        points=payload.task.points,
        badge=payload.task.badge,
        acceptance_criteria_json=_to_json(
            [item.model_dump() for item in payload.task.acceptance_criteria]
        ),
    )
    session.add(task)
    session.flush()

    _log(
        session,
        actor_id,
        "problem.approve",
        "problem",
        problem_id,
        {"task_id": task.id},
    )
    _log(
        session,
        actor_id,
        "task.create",
        "task",
        task.id,
        {"problem_id": problem_id, "level": task.level.value},
    )
    session.commit()
    return TaskRead(
        id=task.id,
        problem_id=task.problem_id,
        title=task.title,
        scenario=problem.scenario,
        level=task.level,
        reward_total=task.reward_total,
        active_claim_count=0,
        due_date=task.due_date,
        status=task.status.value,
        created_at=task.created_at,
    )


async def trigger_problem_analysis(session: Session, problem_id: int) -> ProblemAnalysis:
    problem = session.get(Problem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="问题不存在")

    submitter = session.get(User, problem.submitter_id)
    submitter_name = submitter.name if submitter else ""

    analysis = await run_prodmind_analysis(session, problem, submitter_name)

    problem.analysis_id = analysis.id
    problem.analysis_status = analysis.status

    _log(
        session=session,
        actor_user_id=None,
        action="problem.analysis.triggered",
        target_type="problem",
        target_id=problem_id,
        detail={"analysis_id": analysis.id, "status": analysis.status.value},
    )
    session.commit()

    return analysis


def get_problem_analysis(session: Session, problem_id: int) -> ProblemAnalysis | None:
    problem = session.get(Problem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="问题不存在")
    if problem.analysis_id is None:
        return None
    return session.get(ProblemAnalysis, problem.analysis_id)


def list_hypothesis_verifications(session: Session, analysis_id: int) -> list[HypothesisVerification]:
    return session.exec(
        select(HypothesisVerification)
        .where(HypothesisVerification.analysis_id == analysis_id)
        .order_by(HypothesisVerification.risk_level.desc())
    ).all()


def update_hypothesis_verification(
    session: Session,
    verification_id: int,
    actor_id: int,
    verification_status: HypothesisStatus,
    verification_method: str | None = None,
    verification_result: str | None = None,
) -> HypothesisVerification:
    verification = session.get(HypothesisVerification, verification_id)
    if verification is None:
        raise HTTPException(status_code=404, detail="假设验证记录不存在")

    verification.verification_status = verification_status
    verification.verification_method = verification_method
    verification.verification_result = verification_result
    verification.verified_by = actor_id
    verification.verified_at = datetime.utcnow()

    session.commit()
    session.refresh(verification)
    return verification


def create_analysis_ref(
    session: Session,
    problem_id: int,
    actor_id: int,
    recommendation: str,
    analysis_id: int,
    acceptance_reason: str | None = None,
    rejection_reason: str | None = None,
) -> ProblemReviewAnalysisRef:
    problem = session.get(Problem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="问题不存在")

    analysis = session.get(ProblemAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(status_code=400, detail="论证记录不存在")
    if analysis.problem_id != problem_id:
        raise HTTPException(status_code=400, detail="论证记录不属于当前问题")

    ref = ProblemReviewAnalysisRef(
        problem_id=problem_id,
        recommendation=recommendation,
        analysis_id=analysis_id,
        acceptance_reason=acceptance_reason,
        rejection_reason=rejection_reason,
        reviewed_by=actor_id,
    )
    session.add(ref)
    session.commit()
    session.refresh(ref)
    return ref
