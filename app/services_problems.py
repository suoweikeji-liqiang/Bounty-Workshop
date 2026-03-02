from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import update
from sqlmodel import Session, select

from app.enums import (
    AnalysisStatus,
    HypothesisStatus,
    ProblemStatus,
    Role,
    Scenario,
    TaskLevel,
)
from app.attachments import bind_attachments
from app.models import (
    HypothesisVerification,
    Problem,
    ProblemAnalysis,
    ProblemReviewAnalysisRef,
    SystemConfig,
    Task,
    User,
)
from app.prodmind import run_analysis as run_prodmind_analysis
from app.schemas import (
    PricingDefinition,
    ProblemBudgetReview,
    ProblemCreate,
    ProblemDetailRead,
    ProblemRead,
    ProblemReview,
    ProblemReviewResult,
    TaskRead,
)
from app.services_common import _ensure_role, _ensure_user_exists, _from_json_list, _log, _to_json


BUDGET_REVIEW_THRESHOLD_KEY = "budget_review_threshold"
DEFAULT_BUDGET_REVIEW_THRESHOLD = 3000.0
MIN_BUDGET_REVIEW_THRESHOLD = 0.0


def get_budget_review_threshold(session: Session) -> float:
    row = session.get(SystemConfig, BUDGET_REVIEW_THRESHOLD_KEY)
    if row is None:
        session.add(SystemConfig(key=BUDGET_REVIEW_THRESHOLD_KEY, value=str(DEFAULT_BUDGET_REVIEW_THRESHOLD)))
        session.commit()
        return DEFAULT_BUDGET_REVIEW_THRESHOLD
    try:
        value = float(row.value)
    except ValueError:
        value = DEFAULT_BUDGET_REVIEW_THRESHOLD
    return max(value, MIN_BUDGET_REVIEW_THRESHOLD)


def set_budget_review_threshold(session: Session, threshold: float) -> float:
    value = max(float(threshold), MIN_BUDGET_REVIEW_THRESHOLD)
    row = session.get(SystemConfig, BUDGET_REVIEW_THRESHOLD_KEY)
    now = datetime.utcnow()
    if row is None:
        session.add(SystemConfig(key=BUDGET_REVIEW_THRESHOLD_KEY, value=str(value), updated_at=now))
    else:
        row.value = str(value)
        row.updated_at = now
    session.commit()
    return value


def _problem_to_read(problem: Problem, submitter_name: str) -> ProblemRead:
    return ProblemRead(
        id=problem.id,
        title=problem.title,
        scenario=problem.scenario,
        status=problem.status,
        reject_reason=problem.reject_reason,
        merged_problem_id=problem.merged_problem_id,
        analysis_status=problem.analysis_status,
        reviewer_comment=problem.reviewer_comment,
        submitter_id=problem.submitter_id,
        submitter_name=submitter_name,
        created_at=problem.created_at,
    )


def _problem_to_detail(problem: Problem, submitter_name: str) -> ProblemDetailRead:
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
        draft_goal=problem.draft_goal,
        draft_scope=problem.draft_scope,
        draft_due_date=problem.draft_due_date,
        draft_acceptance_criteria=_from_json_list(problem.draft_acceptance_criteria_json),
        submitter_reflection=problem.submitter_reflection,
        reviewer_comment=problem.reviewer_comment,
        priced_level=problem.priced_level,
        priced_reward_total=problem.priced_reward_total,
        priced_proposer_ratio=problem.priced_proposer_ratio,
        priced_accepter_id=problem.priced_accepter_id,
        priced_points=problem.priced_points,
        priced_badge=problem.priced_badge,
        analysis_status=problem.analysis_status,
        submitter_id=problem.submitter_id,
        submitter_name=submitter_name,
        created_at=problem.created_at,
    )


def _apply_task_draft(problem: Problem, payload: ProblemCreate) -> None:
    if payload.task_draft is None:
        return
    problem.draft_goal = payload.task_draft.goal
    problem.draft_scope = payload.task_draft.scope
    problem.draft_due_date = payload.task_draft.due_date
    problem.draft_acceptance_criteria_json = _to_json(
        [item.model_dump() for item in payload.task_draft.acceptance_criteria]
    )
    problem.submitter_reflection = payload.task_draft.self_reflection


def _reset_pricing(problem: Problem) -> None:
    problem.priced_level = None
    problem.priced_reward_total = None
    problem.priced_proposer_ratio = None
    problem.priced_accepter_id = None
    problem.priced_points = 0
    problem.priced_badge = None
    problem.priced_is_complex = False
    problem.priced_by_user_id = None
    problem.budget_review_comment = None
    problem.budget_reviewed_by_user_id = None
    problem.budget_reviewed_at = None


def create_problem(session: Session, actor_id: int, payload: ProblemCreate) -> ProblemRead:
    user = _ensure_user_exists(session, actor_id)
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
        status=ProblemStatus.DRAFT,
        analysis_status=AnalysisStatus.PENDING,
    )
    _apply_task_draft(problem, payload)
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
        detail={"title": payload.title, "status": problem.status.value},
    )
    session.commit()
    return _problem_to_read(problem, user.name)


def get_problem_detail(
    session: Session,
    actor_id: int,
    actor_roles: set[Role],
    problem_id: int,
) -> ProblemDetailRead:
    problem = session.get(Problem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="problem not found")
    if (
        problem.submitter_id != actor_id
        and Role.ADMIN not in actor_roles
        and Role.REVIEWER not in actor_roles
        and Role.REWARD_APPROVER not in actor_roles
    ):
        raise HTTPException(status_code=403, detail="permission denied")
    user = session.get(User, problem.submitter_id)
    return _problem_to_detail(problem, user.name if user else "")


def resubmit_problem(
    session: Session,
    actor_id: int,
    problem_id: int,
    payload: ProblemCreate,
) -> ProblemRead:
    problem = session.get(Problem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="problem not found")
    if problem.submitter_id != actor_id:
        raise HTTPException(status_code=403, detail="only submitter can edit")
    if problem.status not in {ProblemStatus.DRAFT, ProblemStatus.REJECTED}:
        raise HTTPException(status_code=400, detail="problem cannot be edited in current status")

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
    _apply_task_draft(problem, payload)

    problem.status = ProblemStatus.DRAFT
    problem.reject_reason = None
    problem.merged_problem_id = None
    problem.reviewer_comment = None
    problem.analysis_id = None
    problem.analysis_status = AnalysisStatus.PENDING
    _reset_pricing(problem)

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
    user = session.get(User, problem.submitter_id)
    return _problem_to_read(problem, user.name if user else "")


def submit_problem_for_review(session: Session, actor_id: int, problem_id: int) -> ProblemRead:
    problem = session.get(Problem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="problem not found")
    if problem.submitter_id != actor_id:
        raise HTTPException(status_code=403, detail="only submitter can submit for review")
    if problem.status == ProblemStatus.PENDING_REVIEW:
        user = session.get(User, problem.submitter_id)
        return _problem_to_read(problem, user.name if user else "")
    if problem.status != ProblemStatus.DRAFT:
        raise HTTPException(status_code=400, detail="problem is not in draft status")

    if not problem.draft_goal or not problem.draft_scope or not problem.draft_due_date:
        raise HTTPException(status_code=400, detail="task draft is incomplete")
    if not _from_json_list(problem.draft_acceptance_criteria_json):
        raise HTTPException(status_code=400, detail="at least one acceptance criteria is required")
    if not problem.submitter_reflection:
        raise HTTPException(status_code=400, detail="submitter reflection is required")

    if problem.analysis_status == AnalysisStatus.ANALYZING:
        raise HTTPException(status_code=400, detail="analysis is still running")

    problem.status = ProblemStatus.PENDING_REVIEW
    problem.reviewer_comment = None
    _log(
        session=session,
        actor_user_id=actor_id,
        action="problem.submit_for_review",
        target_type="problem",
        target_id=problem.id,
        detail={"status": problem.status.value},
    )
    session.commit()
    user = session.get(User, problem.submitter_id)
    return _problem_to_read(problem, user.name if user else "")


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
    statement = select(Problem, User.name.label("submitter_name")).join(User, Problem.submitter_id == User.id)
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
    results = session.exec(
        statement.order_by(Problem.created_at.desc()).offset(safe_offset).limit(safe_limit)
    ).all()
    return [_problem_to_read(prob, name) for prob, name in results]


def _pricing_from_review(payload: ProblemReview) -> PricingDefinition:
    if payload.pricing is not None:
        return payload.pricing
    assert payload.task is not None
    return PricingDefinition(
        level=payload.task.level,
        reward_total=payload.task.reward_total,
        proposer_ratio=payload.task.proposer_ratio,
        accepter_id=payload.task.accepter_id,
        points=payload.task.points,
        badge=payload.task.badge,
    )


def _create_task_from_problem(
    session: Session,
    problem: Problem,
    pricing: PricingDefinition,
    title_override: str | None = None,
    is_complex: bool = False,
) -> Task:
    title = ((title_override or "").strip() if title_override is not None else "") or problem.title
    task = Task(
        problem_id=problem.id,
        title=title,
        goal=problem.draft_goal or "",
        scope=problem.draft_scope or "",
        due_date=problem.draft_due_date or date.today(),
        level=pricing.level,
        reward_total=pricing.reward_total,
        proposer_ratio=pricing.proposer_ratio,
        accepter_id=pricing.accepter_id,
        points=pricing.points,
        badge=pricing.badge,
        is_complex=is_complex,
        acceptance_criteria_json=problem.draft_acceptance_criteria_json,
    )
    session.add(task)
    session.flush()
    return task


def _task_to_read(task: Task, problem: Problem) -> TaskRead:
    return TaskRead(
        id=task.id,
        problem_id=task.problem_id,
        title=task.title,
        scenario=problem.scenario,
        level=task.level,
        reward_total=task.reward_total,
        is_complex=task.is_complex,
        active_claim_count=0,
        due_date=task.due_date,
        status=task.status.value,
        created_at=task.created_at,
    )


def _result_with_task(status: ProblemStatus, task_read: TaskRead, message: str | None = None) -> ProblemReviewResult:
    return ProblemReviewResult(
        status=status,
        task=task_read,
        message=message,
        id=task_read.id,
        problem_id=task_read.problem_id,
        title=task_read.title,
        scenario=task_read.scenario,
        level=task_read.level,
        reward_total=task_read.reward_total,
        active_claim_count=task_read.active_claim_count,
        due_date=task_read.due_date,
        created_at=task_read.created_at,
    )


def review_problem(
    session: Session,
    actor_id: int,
    problem_id: int,
    payload: ProblemReview,
) -> ProblemReviewResult | None:
    problem = session.get(Problem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="problem not found")
    if problem.submitter_id == actor_id:
        raise HTTPException(status_code=403, detail="submitter cannot review own problem")

    is_legacy_direct_review = problem.status == ProblemStatus.DRAFT and payload.task is not None
    if (
        problem.status not in {ProblemStatus.PENDING_REVIEW, ProblemStatus.PRICING_REVISION_REQUIRED}
        and not is_legacy_direct_review
    ):
        raise HTTPException(status_code=409, detail="problem is not in a reviewable status")
    # Reviewer pricing flow should wait while analysis is still running,
    # but must not be hard-blocked by failed/missing analysis results.
    if payload.approve and payload.task is None and problem.analysis_status == AnalysisStatus.ANALYZING:
        raise HTTPException(status_code=409, detail="analysis is still running")

    if not payload.approve:
        review_comment = (payload.review_comment or payload.reject_reason or "").strip()
        should_final_reject = payload.final_reject or bool(payload.reject_reason and not payload.review_comment)
        if should_final_reject:
            problem.status = ProblemStatus.REJECTED
            problem.reject_reason = review_comment or "rejected by reviewer"
            action = "problem.reject"
        else:
            problem.status = ProblemStatus.DRAFT
            problem.reviewer_comment = review_comment or "needs updates"
            action = "problem.request_changes"

        _log(
            session,
            actor_id,
            action,
            "problem",
            problem_id,
            {"comment": review_comment},
        )
        session.commit()
        if should_final_reject:
            return None
        return ProblemReviewResult(status=problem.status, message=review_comment)

    if payload.analysis_id:
        analysis = session.get(ProblemAnalysis, payload.analysis_id)
        if analysis is None:
            raise HTTPException(status_code=400, detail="analysis not found")
        if analysis.problem_id != problem_id:
            raise HTTPException(status_code=400, detail="analysis does not belong to this problem")
        ref = ProblemReviewAnalysisRef(
            problem_id=problem_id,
            recommendation=analysis.recommendation or "neutral",
            analysis_id=payload.analysis_id,
            acceptance_reason=payload.analysis_acceptance,
            reviewed_by=actor_id,
        )
        session.add(ref)

    if payload.task is not None and (
        problem.draft_goal is None
        or problem.draft_scope is None
        or problem.draft_due_date is None
        or is_legacy_direct_review
    ):
        problem.draft_goal = payload.task.goal
        problem.draft_scope = payload.task.scope
        problem.draft_due_date = payload.task.due_date
        problem.draft_acceptance_criteria_json = _to_json(
            [item.model_dump() for item in payload.task.acceptance_criteria]
        )
        if not problem.submitter_reflection:
            problem.submitter_reflection = problem.value_statement

    pricing = _pricing_from_review(payload)
    _ensure_role(session, pricing.accepter_id, Role.ACCEPTOR)

    problem.priced_level = pricing.level
    problem.priced_reward_total = pricing.reward_total
    problem.priced_proposer_ratio = pricing.proposer_ratio
    problem.priced_accepter_id = pricing.accepter_id
    problem.priced_points = pricing.points
    problem.priced_badge = pricing.badge
    if payload.task is not None:
        problem.priced_is_complex = payload.task.is_complex
    problem.priced_by_user_id = actor_id
    problem.reviewer_comment = None

    threshold = get_budget_review_threshold(session)
    if pricing.reward_total >= threshold:
        problem.status = ProblemStatus.BUDGET_PENDING
        _log(
            session,
            actor_id,
            "problem.pricing.approve",
            "problem",
            problem_id,
            {
                "reward_total": pricing.reward_total,
                "threshold": threshold,
                "status": problem.status.value,
            },
        )
        session.commit()
        return ProblemReviewResult(
            status=problem.status,
            message="pricing approved, waiting budget review",
        )

    problem.status = ProblemStatus.APPROVED
    problem.reject_reason = None
    problem.merged_problem_id = None
    task_title = payload.task.title if payload.task is not None else None
    task = _create_task_from_problem(
        session,
        problem,
        pricing,
        title_override=task_title,
        is_complex=payload.task.is_complex if payload.task is not None else problem.priced_is_complex,
    )

    _log(
        session,
        actor_id,
        "problem.approve",
        "problem",
        problem_id,
        {"task_id": task.id, "mode": "single_review"},
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
    return _result_with_task(problem.status, _task_to_read(task, problem))


def budget_review_problem(
    session: Session,
    actor_id: int,
    problem_id: int,
    payload: ProblemBudgetReview,
) -> ProblemReviewResult:
    problem = session.get(Problem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="problem not found")
    if problem.submitter_id == actor_id:
        raise HTTPException(status_code=403, detail="submitter cannot budget-review own problem")
    if problem.status != ProblemStatus.BUDGET_PENDING:
        raise HTTPException(status_code=409, detail="problem is not waiting budget review")
    if problem.priced_level is None or problem.priced_reward_total is None or problem.priced_accepter_id is None:
        raise HTTPException(status_code=400, detail="problem pricing is incomplete")

    problem.budget_review_comment = payload.comment
    problem.budget_reviewed_by_user_id = actor_id
    problem.budget_reviewed_at = datetime.utcnow()

    if not payload.approve:
        problem.status = ProblemStatus.PRICING_REVISION_REQUIRED
        problem.reviewer_comment = payload.comment or "budget rejected, please re-price"
        _log(
            session,
            actor_id,
            "problem.budget.reject",
            "problem",
            problem_id,
            {"comment": payload.comment},
        )
        session.commit()
        return ProblemReviewResult(status=problem.status, message=problem.reviewer_comment)

    pricing = PricingDefinition(
        level=TaskLevel(problem.priced_level),
        reward_total=problem.priced_reward_total,
        proposer_ratio=problem.priced_proposer_ratio or 0.2,
        accepter_id=problem.priced_accepter_id,
        points=problem.priced_points,
        badge=problem.priced_badge,
    )

    task = _create_task_from_problem(
        session,
        problem,
        pricing,
        is_complex=problem.priced_is_complex,
    )
    problem.status = ProblemStatus.APPROVED
    problem.reject_reason = None
    problem.merged_problem_id = None

    _log(
        session,
        actor_id,
        "problem.budget.approve",
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
        {"problem_id": problem_id, "level": task.level.value, "mode": "dual_review"},
    )
    session.commit()
    return _result_with_task(problem.status, _task_to_read(task, problem))


async def trigger_problem_analysis(session: Session, problem_id: int) -> ProblemAnalysis:
    problem = session.get(Problem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="problem not found")

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
        raise HTTPException(status_code=404, detail="problem not found")
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
        raise HTTPException(status_code=404, detail="hypothesis verification not found")

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
        raise HTTPException(status_code=404, detail="problem not found")

    analysis = session.get(ProblemAnalysis, analysis_id)
    if analysis is None:
        raise HTTPException(status_code=400, detail="analysis not found")
    if analysis.problem_id != problem_id:
        raise HTTPException(status_code=400, detail="analysis does not belong to this problem")

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
