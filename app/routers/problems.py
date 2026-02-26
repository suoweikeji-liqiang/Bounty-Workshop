from __future__ import annotations

import asyncio
import logging
from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from fastapi import HTTPException
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
    ProblemReviewResult,
    ProblemSubmitResult,
    ProblemReviewAnalysisRefCreate,
)
from app.services import (
    budget_review_problem,
    create_analysis_ref,
    create_problem,
    get_problem_analysis,
    get_problem_detail,
    list_hypothesis_verifications,
    list_problems,
    submit_problem_for_review,
    resubmit_problem,
    review_problem,
    trigger_problem_analysis,
    update_hypothesis_verification,
)

router = APIRouter(tags=["problems"])
_logger = logging.getLogger(__name__)


def _trigger_analysis_background(problem_id: int) -> None:
    try:
        with Session(engine) as session:
            asyncio.run(trigger_problem_analysis(session, problem_id))
    except Exception:
        _logger.exception("Background analysis failed for problem_id=%s", problem_id)


@router.post("/problems", response_model=ProblemRead)
def post_problem(
    payload: ProblemCreate,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> ProblemRead:
    problem = create_problem(session, actor_id=actor_id, payload=payload)
    # Analysis can be triggered manually from the problem workflow; avoid implicit
    # background runs bound to a global engine/session.
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
    # Keep analysis trigger explicit to avoid race conditions in detached workers.
    return result


@router.post("/problems/{problem_id}/submit-for-review", response_model=ProblemSubmitResult)
def post_problem_submit_for_review(
    problem_id: int,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> ProblemSubmitResult:
    result = submit_problem_for_review(session, actor_id=actor_id, problem_id=problem_id)
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
        session, user_id=actor_id, mine_only=mine_only, status=status,
        scenario=scenario, created_from=created_from, created_to=created_to,
        offset=offset, limit=limit,
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
async def post_problem_analyze(
    problem_id: int,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    problem = session.get(Problem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="问题不存在")
    actor_roles = get_user_roles(session, actor_id)
    if problem.submitter_id != actor_id and Role.ADMIN not in actor_roles and Role.REVIEWER not in actor_roles:
        raise HTTPException(status_code=403, detail="无权触发该问题分析")
    try:
        analysis = await trigger_problem_analysis(session, problem_id)
        return {
            "analysis_id": analysis.id,
            "status": analysis.status.value,
            "message": "论证已启动" if analysis.status == AnalysisStatus.ANALYZING else "论证完成",
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


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
        raise HTTPException(status_code=404, detail="问题不存在")
    actor_roles = get_user_roles(session, actor_id)
    if problem.submitter_id != actor_id and Role.ADMIN not in actor_roles and Role.REVIEWER not in actor_roles:
        raise HTTPException(status_code=403, detail="无权查看该问题分析")
    analysis = get_problem_analysis(session, problem_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="分析报告不存在")
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
        raise HTTPException(status_code=404, detail="问题不存在")
    actor_roles = get_user_roles(session, actor_id)
    if problem.submitter_id != actor_id and Role.ADMIN not in actor_roles and Role.REVIEWER not in actor_roles:
        raise HTTPException(status_code=403, detail="无权查看该问题分析")
    analysis = get_problem_analysis(session, problem_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="分析报告不存在")
    verifications = list_hypothesis_verifications(session, analysis.id)
    return [
        {
            "id": v.id,
            "analysis_id": v.analysis_id,
            "hypothesis_content": v.hypothesis_content,
            "hypothesis_type": v.hypothesis_type.value,
            "risk_level": v.risk_level.value,
            "verification_status": v.verification_status.value,
            "verification_method": v.verification_method,
            "verification_result": v.verification_result,
            "verified_by": v.verified_by,
            "verified_at": v.verified_at.isoformat() if v.verified_at else None,
            "created_at": v.created_at.isoformat(),
        }
        for v in verifications
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
        raise HTTPException(status_code=404, detail="分析报告不存在")
    verification = update_hypothesis_verification(
        session, hypothesis_id, actor_id,
        payload.verification_status, payload.verification_method, payload.verification_result,
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
        session, problem_id, actor_id,
        payload.recommendation, payload.analysis_id,
        payload.acceptance_reason, payload.rejection_reason,
    )
    return {
        "id": ref.id,
        "problem_id": ref.problem_id,
        "recommendation": ref.recommendation,
        "analysis_id": ref.analysis_id,
    }
