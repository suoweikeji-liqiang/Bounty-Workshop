from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi import HTTPException
from sqlmodel import Session

from app.auth import get_current_user_id, get_user_roles, require_roles
from app.db import get_session
from app.enums import ClaimApprovalStatus, ClaimStatus, Role
from app.rate_limit import rate_limit
from app.schemas import (
    AcceptanceCreate,
    ClaimApprovalRequestRead,
    ClaimApprovalReviewInput,
    ClaimCreate,
    ClaimExecutionDetailRead,
    ClaimExecutionRead,
    DeliverableCreate,
    PendingAcceptanceRead,
)
from app.services import (
    abandon_claim,
    accept_deliverable,
    approve_claim_approval_request,
    claim_task,
    get_claim_execution_detail,
    list_claim_approval_requests,
    list_my_claims,
    list_my_pending_acceptance,
    reject_claim_approval_request,
    submit_deliverable,
)

router = APIRouter(tags=["claims"])


@router.post(
    "/tasks/{task_id}/claims",
    dependencies=[Depends(rate_limit("task_claim", limit=30, window_seconds=60))],
)
def post_claim_task(
    task_id: int,
    payload: ClaimCreate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    actor_roles = get_user_roles(session, actor_id)
    return claim_task(
        session, actor_id=actor_id, actor_roles=actor_roles,
        task_id=task_id, payload=payload,
    )


@router.post("/claims/{claim_id}/abandon")
def post_claim_abandon(
    claim_id: int,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    return abandon_claim(session, actor_id=actor_id, claim_id=claim_id)


@router.get("/claims/mine", response_model=list[ClaimExecutionRead])
def get_claims_mine(
    status: str | None = Query(default=None),
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> list[ClaimExecutionRead]:
    if status:
        try:
            parsed_status = ClaimStatus(status)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="无效的 claim status") from exc
    else:
        parsed_status = None
    return list_my_claims(session, user_id=actor_id, status=parsed_status)


@router.get("/claims/overdue-approvals/mine", response_model=list[ClaimApprovalRequestRead])
def get_my_overdue_approval_requests(
    status: str | None = Query(default=None),
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> list[ClaimApprovalRequestRead]:
    parsed_status = None
    if status:
        try:
            parsed_status = ClaimApprovalStatus(status)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid approval status") from exc
    return list_claim_approval_requests(session, actor_id=actor_id, mine_only=True, status=parsed_status)


@router.get(
    "/claims/overdue-approvals/pending",
    response_model=list[ClaimApprovalRequestRead],
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER))],
)
def get_pending_overdue_approval_requests(
    status: str = Query(default="pending", pattern="^(pending|approved|rejected)$"),
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> list[ClaimApprovalRequestRead]:
    parsed_status = ClaimApprovalStatus(status)
    return list_claim_approval_requests(session, actor_id=actor_id, mine_only=False, status=parsed_status)


@router.post(
    "/claims/overdue-approvals/{request_id}/approve",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER))],
)
def post_approve_overdue(
    request_id: int,
    payload: ClaimApprovalReviewInput,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    actor_roles = get_user_roles(session, actor_id)
    return approve_claim_approval_request(
        session=session, actor_id=actor_id, actor_roles=actor_roles,
        request_id=request_id, comment=payload.comment,
    )


@router.post(
    "/claims/overdue-approvals/{request_id}/reject",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER))],
)
def post_reject_overdue(
    request_id: int,
    payload: ClaimApprovalReviewInput,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    return reject_claim_approval_request(
        session=session, actor_id=actor_id,
        request_id=request_id, comment=payload.comment,
    )


@router.get("/claims/{claim_id}/detail", response_model=ClaimExecutionDetailRead)
def get_claim_detail(
    claim_id: int,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> ClaimExecutionDetailRead:
    actor_roles = get_user_roles(session, actor_id)
    return get_claim_execution_detail(session, actor_id=actor_id, actor_roles=actor_roles, claim_id=claim_id)


@router.get("/deliverables/pending-acceptance/mine", response_model=list[PendingAcceptanceRead])
def get_pending_acceptance_mine(
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> list[PendingAcceptanceRead]:
    return list_my_pending_acceptance(session, user_id=actor_id)


@router.post("/claims/{claim_id}/deliverables")
def post_submit_deliverable(
    claim_id: int,
    payload: DeliverableCreate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    return submit_deliverable(session, actor_id=actor_id, claim_id=claim_id, payload=payload)


@router.post("/deliverables/{deliverable_id}/accept")
def post_accept_deliverable(
    deliverable_id: int,
    payload: AcceptanceCreate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    return accept_deliverable(
        session, actor_id=actor_id, deliverable_id=deliverable_id,
        result=payload.result, comment=payload.comment,
    )
