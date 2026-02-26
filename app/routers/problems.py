from __future__ import annotations

import asyncio
import logging
from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlmodel import Session

from app.auth import get_current_user_id, get_user_roles, require_roles
from app.db import engine, get_session
from app.enums import AnalysisStatus, ProblemStatus, Role, Scenario
from app.models import Problem
from app.prodmind import get_analysis_report
from app.schemas import (
    HypothesisVerificationUpdate,
    ProblemBudgetReview,
    ProblemCreate,
    ProblemDetailRead,
    ProblemRead,
    ProblemReview,
    ProblemReviewAnalysisRefCreate,
    ProblemReviewResult,
    ProblemSubmitResult,
)
from app.services import (
    budget_review_problem,
    create_analysis_ref,
    create_problem,
    get_problem_analysis,
    get_problem_detail,
    list_hypothesis_verifications,
    list_problems,
    resubmit_problem,
    review_problem,
    submit_problem_for_review,
    trigger_problem_analysis,
    update_hypothesis_verification,
)

router = APIRouter(tags=["problems"])
_logger = logging.getLogger(__name__)


def _set_problem_analysis_status(problem_id: int, status: AnalysisStatus, clear_analysis_ref: bool = False) -> None:
    with Session(engine) as session:
        problem = session.get(Problem, problem_id)
        if problem is None:
            return
        problem.analysis_status = status
        if clear_analysis_ref:
            problem.analysis_id = None
        session.commit()


def _trigger_analysis_background(problem_id: int) -> None:
    try:
        _set_problem_analysis_status(problem_id, AnalysisStatus.ANALYZING, clear_analysis_ref=True)
    except Exception:
        _logger.exception("Failed to mark problem analyzing for problem_id=%s", problem_id)

    try:
        with Session(engine) as session:
            asyncio.run(trigger_problem_analysis(session, problem_id))
    except ValueError as exc:
        _logger.warning("Background analysis skipped for problem_id=%s: %s", problem_id, exc)
        try:
            _set_problem_analysis_status(problem_id, AnalysisStatus.FAILED)
        except Exception:
            _logger.exception("Failed to mark problem failed for problem_id=%s", problem_id)
    except Exception:
        _logger.exception("Background analysis failed for problem_id=%s", problem_id)
        try:
            _set_problem_analysis_status(problem_id, AnalysisStatus.FAILED)
        except Exception:
            _logger.exception("Failed to mark problem failed for problem_id=%s", problem_id)


@router.post("/problems", response_model=ProblemRead)
def post_problem(
    payload: ProblemCreate,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> ProblemRead:
    problem = create_problem(session, actor_id=actor_id, payload=payload)
    # Keep analysis explicit from submit-for-review and manual analyze action.
    return problem


@router.put("/problems/{problem_id}/resubmit", response_model=ProblemRead)
def put_problem_resubmit(
    problem_id: int,
    payload: ProblemCreate,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> ProblemRead:
    result = resubmit_problem(session, actor_id=actor_id, problem_id=problem_id, payload=payload)
    # Keep analysis explicit from submit-for-review and manual analyze action.
    return result


@router.post("/problems/{problem_id}/submit-for-review", response_model=ProblemSubmitResult)
def post_problem_submit_for_review(
    problem_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> ProblemSubmitResult:
    result = submit_problem_for_review(session, actor_id=actor_id, problem_id=problem_id)
    if result.analysis_status in {AnalysisStatus.PENDING, AnalysisStatus.FAILED}:
        background_tasks.add_task(_trigger_analysis_background, problem_id)
    return ProblemSubmitResult(id=result.id, status=result.status)


@router.get("/problems", response_model=list[ProblemRead])
def get_problems(
    mine_only: bool = Query(default=False),
    status: ProblemStatus | None = Query(default=None),
    scenario: Scenario | None = Query(default=None),
    created_from: date | None = Query(default=None),
    created_to: date | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=200),
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> list[ProblemRead]:
    return list_problems(
        session,
        user_id=actor_id,
        mine_only=mine_only,
        status=status,
        scenario=scenario,
        created_from=created_from,
        created_to=created_to,
        offset=offset,
        limit=limit,
    )


@router.get("/problems/{problem_id}", response_model=ProblemDetailRead)
def get_problem(
    problem_id: int,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> ProblemDetailRead:
    actor_roles = get_user_roles(session, actor_id)
    return get_problem_detail(session, actor_id=actor_id, actor_roles=actor_roles, problem_id=problem_id)


@router.post(
    "/problems/{problem_id}/review",
    response_model=ProblemReviewResult | None,
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER))],
)
def post_problem_review(
    problem_id: int,
    payload: ProblemReview,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> ProblemReviewResult | None:
    return review_problem(session, actor_id=actor_id, problem_id=problem_id, payload=payload)


@router.post(
    "/problems/{problem_id}/budget-review",
    response_model=ProblemReviewResult,
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REWARD_APPROVER))],
)
def post_problem_budget_review(
    problem_id: int,
    payload: ProblemBudgetReview,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> ProblemReviewResult:
    return budget_review_problem(session, actor_id=actor_id, problem_id=problem_id, payload=payload)


@router.post(
    "/problems/{problem_id}/analyze",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER, Role.EMPLOYEE))],
)
def post_problem_analyze(
    problem_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    problem = session.get(Problem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="problem not found")
    actor_roles = get_user_roles(session, actor_id)
    if problem.submitter_id != actor_id and Role.ADMIN not in actor_roles and Role.REVIEWER not in actor_roles:
        raise HTTPException(status_code=403, detail="permission denied")

    if problem.analysis_status != AnalysisStatus.ANALYZING:
        problem.analysis_status = AnalysisStatus.ANALYZING
        problem.analysis_id = None
        session.commit()

    background_tasks.add_task(_trigger_analysis_background, problem_id)
    return {
        "analysis_id": problem.analysis_id,
        "status": AnalysisStatus.ANALYZING.value,
        "message": "analysis started",
    }


@router.get(
    "/problems/{problem_id}/analysis",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER, Role.EMPLOYEE))],
)
def get_problem_analysis_report(
    problem_id: int,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    problem = session.get(Problem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="problem not found")
    actor_roles = get_user_roles(session, actor_id)
    if problem.submitter_id != actor_id and Role.ADMIN not in actor_roles and Role.REVIEWER not in actor_roles:
        raise HTTPException(status_code=403, detail="permission denied")
    analysis = get_problem_analysis(session, problem_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="analysis not found")

    report = get_analysis_report(analysis)
    return {
        "id": analysis.id,
        "problem_id": analysis.problem_id,
        "status": analysis.status.value,
        "recommendation": analysis.recommendation,
        "confidence": analysis.confidence,
        "rounds": analysis.rounds,
        "error_message": analysis.error_message,
        "report": report,
        "created_at": analysis.created_at.isoformat(),
        "updated_at": analysis.updated_at.isoformat(),
    }


@router.get(
    "/problems/{problem_id}/hypotheses",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER, Role.EMPLOYEE))],
)
def get_problem_hypotheses(
    problem_id: int,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> list[dict]:
    problem = session.get(Problem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="problem not found")
    actor_roles = get_user_roles(session, actor_id)
    if problem.submitter_id != actor_id and Role.ADMIN not in actor_roles and Role.REVIEWER not in actor_roles:
        raise HTTPException(status_code=403, detail="permission denied")
    analysis = get_problem_analysis(session, problem_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="analysis not found")

    verifications = list_hypothesis_verifications(session, analysis.id)
    return [
        {
            "id": item.id,
            "analysis_id": item.analysis_id,
            "hypothesis_content": item.hypothesis_content,
            "hypothesis_type": item.hypothesis_type.value,
            "risk_level": item.risk_level.value,
            "verification_status": item.verification_status.value,
            "verification_method": item.verification_method,
            "verification_result": item.verification_result,
            "verified_by": item.verified_by,
            "verified_at": item.verified_at.isoformat() if item.verified_at else None,
            "created_at": item.created_at.isoformat(),
        }
        for item in verifications
    ]


@router.put(
    "/problems/{problem_id}/hypotheses/{hypothesis_id}",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER))],
)
def put_hypothesis_verification(
    problem_id: int,
    hypothesis_id: int,
    payload: HypothesisVerificationUpdate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    analysis = get_problem_analysis(session, problem_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="analysis not found")

    verification = update_hypothesis_verification(
        session,
        hypothesis_id,
        actor_id,
        payload.verification_status,
        payload.verification_method,
        payload.verification_result,
    )
    return {
        "id": verification.id,
        "verification_status": verification.verification_status.value,
        "verification_method": verification.verification_method,
        "verification_result": verification.verification_result,
    }


@router.post(
    "/problems/{problem_id}/analysis-ref",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER))],
)
def post_analysis_ref(
    problem_id: int,
    payload: ProblemReviewAnalysisRefCreate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    ref = create_analysis_ref(
        session,
        problem_id,
        actor_id,
        payload.recommendation,
        payload.analysis_id,
        payload.acceptance_reason,
        payload.rejection_reason,
    )
    return {
        "id": ref.id,
        "problem_id": ref.problem_id,
        "recommendation": ref.recommendation,
        "analysis_id": ref.analysis_id,
    }
