import asyncio
from contextlib import suppress
from contextlib import asynccontextmanager
from datetime import date
import os

from fastapi import Depends, FastAPI, File, Query, UploadFile
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse
from sqlmodel import Session, select

from app.attachments import (
    attachment_to_read,
    create_attachment,
    ensure_attachment_access,
    ensure_entity_attachment_access,
    get_attachment_or_404,
    get_presigned_download_url,
    list_attachments_by_entity,
    local_file_path,
)
from app.auth import (
    create_access_token,
    get_current_user_id,
    get_user_roles,
    is_passwordless_login_enabled,
    require_roles,
)
from app.db import engine, get_session, init_db
from app.enums import (
    ClaimApprovalStatus,
    ProblemStatus,
    RewardStatus,
    Role,
    Scenario,
    TaskLevel,
    TaskStatus,
    UserStatus,
)
from app.feishu import (
    consume_oauth_state,
    create_oauth_state,
    get_feishu_provider,
    get_acceptance_templates,
    get_sync_frequency_minutes,
    list_departments as list_synced_departments,
    login_by_feishu_code,
    run_feishu_sync,
    set_acceptance_templates,
    set_sync_frequency_minutes,
)
from app.jobs import (
    get_release_overdue_frequency_minutes,
    is_background_jobs_enabled,
    is_feishu_sync_job_enabled,
    run_feishu_sync_scheduler,
    run_release_overdue_scheduler,
    set_release_overdue_frequency_minutes,
)
from app.rate_limit import rate_limit
from app.models import User, UserRole
from app.schemas import (
    AcceptanceCreate,
    ClaimApprovalThresholdConfig,
    ClaimApprovalRequestRead,
    ClaimApprovalReviewInput,
    AcceptanceTemplatesConfig,
    AuthLoginRequest,
    AuthLoginResponse,
    ClaimCreate,
    ClaimExecutionDetailRead,
    ClaimExecutionRead,
    AttachmentRead,
    AttachmentPresignRead,
    DepartmentRead,
    DashboardDistribution,
    DashboardRankings,
    DashboardTrends,
    DeliverableCreate,
    FeishuLoginResult,
    FeishuLoginUrlResponse,
    FeishuSyncResult,
    OperationLogRead,
    PersonalSummaryRead,
    PerformanceReviewRead,
    PerformanceReviewUpsert,
    PendingAcceptanceRead,
    ProblemCreate,
    ProblemRead,
    ProblemReview,
    RewardRead,
    RoleUpdate,
    SyncFrequencyConfig,
    SystemConfigOverviewRead,
    TaskRead,
    TaskDetailRead,
    TimeRange,
    TrendGranularity,
    UserCreate,
    UserRead,
    UserStatusUpdate,
)
from app.reporting import (
    dashboard_distribution,
    dashboard_rankings,
    dashboard_trends,
    export_dashboard_excel,
    export_knowledge_excel,
    export_knowledge_pdf,
    export_rewards_excel,
    export_tasks_excel,
)
from app.services import (
    accept_deliverable,
    abandon_claim,
    approve_claim_approval_request,
    claim_task,
    confirm_reward,
    create_problem,
    create_user,
    dashboard_overview,
    get_knowledge_detail,
    get_my_profile,
    get_my_summary,
    get_claim_execution_detail,
    get_performance_review_snapshot,
    get_claim_approval_overdue_threshold,
    get_user_detail,
    get_task_detail,
    list_acceptor_candidates,
    list_active_users,
    list_knowledge,
    list_my_claims,
    list_my_pending_acceptance,
    list_operation_logs,
    list_problems,
    list_rewards,
    list_tasks,
    list_users,
    release_overdue_claims,
    reject_claim_approval_request,
    review_problem,
    set_user_roles,
    set_user_status,
    set_claim_approval_overdue_threshold,
    submit_deliverable,
    upsert_performance_review_snapshot,
    list_claim_approval_requests,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    with Session(engine) as session:
        existing = session.exec(select(User).where(User.id == 1)).first()
        if existing is None:
            admin = User(name="System Admin", employee_no="A0001", department="Platform")
            session.add(admin)
            session.flush()
            for role in [Role.ADMIN, Role.REVIEWER, Role.ACCEPTOR, Role.EMPLOYEE]:
                session.add(UserRole(user_id=admin.id, role=role))
            session.commit()
    stop_event = asyncio.Event()
    scheduler_tasks: list[asyncio.Task] = []
    if is_background_jobs_enabled():
        scheduler_tasks.append(asyncio.create_task(
            run_release_overdue_scheduler(lambda: Session(engine), stop_event)
        ))
        if is_feishu_sync_job_enabled():
            scheduler_tasks.append(asyncio.create_task(
                run_feishu_sync_scheduler(lambda: Session(engine), stop_event)
            ))
    yield
    stop_event.set()
    for scheduler_task in scheduler_tasks:
        scheduler_task.cancel()
        with suppress(asyncio.CancelledError):
            await scheduler_task


app = FastAPI(title="鎻鎸傚竻浠诲姟绠＄悊绯荤粺 MVP", version="0.1.0", lifespan=lifespan)

cors_origins = [
    item.strip()
    for item in os.getenv(
        "CORS_ALLOW_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173",
    ).split(",")
    if item.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/auth/login", response_model=AuthLoginResponse)
def post_auth_login(
    payload: AuthLoginRequest,
    session: Session = Depends(get_session),
) -> AuthLoginResponse:
    if not is_passwordless_login_enabled():
        raise HTTPException(status_code=403, detail="passwordless login is disabled")

    user: User | None = None
    if payload.user_id is not None:
        user = session.get(User, payload.user_id)
    elif payload.employee_no:
        employee_no = payload.employee_no.strip()
        if employee_no:
            user = session.exec(select(User).where(User.employee_no == employee_no)).first()
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    if user.status == UserStatus.DISABLED:
        raise HTTPException(status_code=403, detail="user is disabled")

    access_token, expires_in = create_access_token(user.id)
    return AuthLoginResponse(
        access_token=access_token,
        expires_in=expires_in,
        user=get_my_profile(session, user.id),
    )


@app.get("/me", response_model=UserRead)
def get_me(
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> UserRead:
    return get_my_profile(session, actor_id)


@app.get("/me/summary", response_model=PersonalSummaryRead)
def get_me_summary(
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> PersonalSummaryRead:
    return get_my_summary(session, actor_id)


@app.post("/attachments/upload", response_model=AttachmentRead)
async def post_attachment_upload(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> AttachmentRead:
    content = await file.read()
    attachment = create_attachment(
        session=session,
        uploader_user_id=actor_id,
        filename=file.filename or "file.bin",
        content_type=file.content_type,
        content=content,
    )
    return attachment


@app.get("/attachments/{attachment_id}", response_model=AttachmentRead)
def get_attachment_metadata(
    attachment_id: int,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> AttachmentRead:
    attachment = get_attachment_or_404(session, attachment_id)
    actor_roles = get_user_roles(session, actor_id)
    ensure_attachment_access(session, actor_id=actor_id, actor_roles=actor_roles, attachment=attachment)
    return attachment_to_read(attachment)

@app.get("/attachments/{attachment_id}/download", response_model=None)
def get_attachment_download(
    attachment_id: int,
    expires_in: int = Query(default=3600, ge=60, le=86400),
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> StreamingResponse:
    attachment = get_attachment_or_404(session, attachment_id)
    actor_roles = get_user_roles(session, actor_id)
    ensure_attachment_access(session, actor_id=actor_id, actor_roles=actor_roles, attachment=attachment)
    if attachment.storage_backend == "s3":
        url = get_presigned_download_url(attachment, expires_in=expires_in)
        return RedirectResponse(url=url, status_code=307)
    if attachment.storage_backend != "local":
        raise HTTPException(status_code=501, detail="unsupported storage backend")
    file_path = local_file_path(attachment.object_key)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="attachment file not found")
    payload = file_path.read_bytes()
    return StreamingResponse(
        iter([payload]),
        media_type=attachment.content_type or "application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{attachment.filename}"',
            "Content-Length": str(len(payload)),
        },
    )

@app.get("/attachments/{attachment_id}/presign", response_model=AttachmentPresignRead)
def get_attachment_presign(
    attachment_id: int,
    expires_in: int = Query(default=3600, ge=60, le=86400),
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> AttachmentPresignRead:
    attachment = get_attachment_or_404(session, attachment_id)
    actor_roles = get_user_roles(session, actor_id)
    ensure_attachment_access(session, actor_id=actor_id, actor_roles=actor_roles, attachment=attachment)
    if attachment.storage_backend != "s3":
        raise HTTPException(status_code=400, detail="presign is only available for s3 attachments")
    url = get_presigned_download_url(attachment, expires_in=expires_in)
    return AttachmentPresignRead(attachment_id=attachment_id, url=url, expires_in=expires_in)

@app.get("/entities/{entity_type}/{entity_id}/attachments", response_model=list[AttachmentRead])
def get_entity_attachments(
    entity_type: str,
    entity_id: int,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> list[AttachmentRead]:
    if entity_type not in {"problem", "deliverable"}:
        raise HTTPException(status_code=400, detail="entity_type only supports problem or deliverable")
    actor_roles = get_user_roles(session, actor_id)
    ensure_entity_attachment_access(
        session,
        actor_id=actor_id,
        actor_roles=actor_roles,
        entity_type=entity_type,
        entity_id=entity_id,
    )
    return list_attachments_by_entity(session, entity_type=entity_type, entity_id=entity_id)

@app.get("/auth/feishu/login-url", response_model=FeishuLoginUrlResponse)
def get_feishu_login_url(
    session: Session = Depends(get_session),
    provider=Depends(get_feishu_provider),
) -> FeishuLoginUrlResponse:
    state_record = create_oauth_state(session, provider_name=provider.provider_name)
    return FeishuLoginUrlResponse(
        provider=provider.provider_name,
        state=state_record.state,
        login_url=provider.build_login_url(state_record.state),
        expires_at=state_record.expires_at,
    )


@app.get("/auth/feishu/callback", response_model=FeishuLoginResult)
def get_feishu_callback(
    code: str = Query(..., min_length=1),
    state: str | None = Query(default=None),
    session: Session = Depends(get_session),
    provider=Depends(get_feishu_provider),
) -> FeishuLoginResult:
    if state:
        consume_oauth_state(session, provider_name=provider.provider_name, state=state)
    profile = provider.fetch_profile_by_code(code)
    login_result = login_by_feishu_code(session, profile=profile)
    access_token, expires_in = create_access_token(login_result.user_id)
    return login_result.model_copy(
        update={"access_token": access_token, "token_type": "Bearer", "expires_in": expires_in}
    )


@app.get("/users", response_model=list[UserRead], dependencies=[Depends(require_roles(Role.ADMIN))])
def get_users(session: Session = Depends(get_session)) -> list[UserRead]:
    return list_users(session)


@app.get("/users/active", response_model=list[UserRead])
def get_users_active(session: Session = Depends(get_session)) -> list[UserRead]:
    return list_active_users(session)


@app.get(
    "/users/acceptors",
    response_model=list[UserRead],
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER))],
)
def get_users_acceptors(session: Session = Depends(get_session)) -> list[UserRead]:
    return list_acceptor_candidates(session)


@app.get("/users/{user_id}", response_model=UserRead, dependencies=[Depends(require_roles(Role.ADMIN))])
def get_user(
    user_id: int,
    session: Session = Depends(get_session),
) -> UserRead:
    return get_user_detail(session, user_id)


@app.post("/users", response_model=UserRead, dependencies=[Depends(require_roles(Role.ADMIN))])
def post_users(
    payload: UserCreate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> UserRead:
    return create_user(session, actor_id=actor_id, payload=payload)


@app.put(
    "/users/{user_id}/roles",
    response_model=UserRead,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def put_user_roles(
    user_id: int,
    payload: RoleUpdate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> UserRead:
    return set_user_roles(session, actor_id=actor_id, user_id=user_id, payload=payload)


@app.put(
    "/users/{user_id}/status",
    response_model=UserRead,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def put_user_status(
    user_id: int,
    payload: UserStatusUpdate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> UserRead:
    return set_user_status(session, actor_id=actor_id, user_id=user_id, payload=payload)


@app.post("/problems", response_model=ProblemRead)
def post_problem(
    payload: ProblemCreate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> ProblemRead:
    return create_problem(session, actor_id=actor_id, payload=payload)


@app.get("/problems", response_model=list[ProblemRead])
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


@app.post(
    "/problems/{problem_id}/review",
    response_model=TaskRead | None,
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER))],
)
def post_problem_review(
    problem_id: int,
    payload: ProblemReview,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> TaskRead | None:
    return review_problem(session, actor_id=actor_id, problem_id=problem_id, payload=payload)


@app.get("/tasks", response_model=list[TaskRead])
def get_tasks(
    status: TaskStatus | None = Query(default=None),
    level: TaskLevel | None = Query(default=None),
    scenario: Scenario | None = Query(default=None),
    reward_min: float | None = Query(default=None),
    reward_max: float | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=200),
    session: Session = Depends(get_session),
) -> list[TaskRead]:
    return list_tasks(
        session,
        status=status,
        level=level,
        scenario=scenario,
        reward_min=reward_min,
        reward_max=reward_max,
        offset=offset,
        limit=limit,
    )


@app.get("/tasks/{task_id}", response_model=TaskDetailRead)
def get_task(
    task_id: int,
    session: Session = Depends(get_session),
) -> TaskDetailRead:
    return get_task_detail(session, task_id=task_id)


@app.post(
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
        session,
        actor_id=actor_id,
        actor_roles=actor_roles,
        task_id=task_id,
        payload=payload,
    )


@app.post("/claims/{claim_id}/abandon")
def post_claim_abandon(
    claim_id: int,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    return abandon_claim(session, actor_id=actor_id, claim_id=claim_id)


@app.get("/claims/mine", response_model=list[ClaimExecutionRead])
def get_claims_mine(
    status: str | None = Query(default=None),
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> list[ClaimExecutionRead]:
    from app.enums import ClaimStatus

    if status:
        try:
            parsed_status = ClaimStatus(status)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="鏃犳晥鐨?claim status") from exc
    else:
        parsed_status = None
    return list_my_claims(session, user_id=actor_id, status=parsed_status)


@app.get("/claims/overdue-approvals/mine", response_model=list[ClaimApprovalRequestRead])
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
    return list_claim_approval_requests(
        session,
        actor_id=actor_id,
        mine_only=True,
        status=parsed_status,
    )


@app.get(
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
    return list_claim_approval_requests(
        session,
        actor_id=actor_id,
        mine_only=False,
        status=parsed_status,
    )


@app.post(
    "/claims/overdue-approvals/{request_id}/approve",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER))],
)
def post_approve_overdue_claim_request(
    request_id: int,
    payload: ClaimApprovalReviewInput,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    actor_roles = get_user_roles(session, actor_id)
    return approve_claim_approval_request(
        session=session,
        actor_id=actor_id,
        actor_roles=actor_roles,
        request_id=request_id,
        comment=payload.comment,
    )


@app.post(
    "/claims/overdue-approvals/{request_id}/reject",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER))],
)
def post_reject_overdue_claim_request(
    request_id: int,
    payload: ClaimApprovalReviewInput,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    return reject_claim_approval_request(
        session=session,
        actor_id=actor_id,
        request_id=request_id,
        comment=payload.comment,
    )


@app.get("/claims/{claim_id}/detail", response_model=ClaimExecutionDetailRead)
def get_claim_detail(
    claim_id: int,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> ClaimExecutionDetailRead:
    roles = get_user_roles(session, actor_id)
    return get_claim_execution_detail(session, actor_id=actor_id, actor_roles=roles, claim_id=claim_id)


@app.get("/claims/{claim_id}/performance-review", response_model=PerformanceReviewRead)
def get_claim_performance_review(
    claim_id: int,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> PerformanceReviewRead:
    roles = get_user_roles(session, actor_id)
    return get_performance_review_snapshot(
        session=session,
        actor_id=actor_id,
        actor_roles=roles,
        claim_id=claim_id,
    )


@app.put("/claims/{claim_id}/performance-review", response_model=PerformanceReviewRead)
def put_claim_performance_review(
    claim_id: int,
    payload: PerformanceReviewUpsert,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> PerformanceReviewRead:
    roles = get_user_roles(session, actor_id)
    return upsert_performance_review_snapshot(
        session=session,
        actor_id=actor_id,
        actor_roles=roles,
        claim_id=claim_id,
        payload=payload,
    )


@app.post(
    "/claims/{claim_id}/deliverables",
    dependencies=[Depends(rate_limit("deliverable_submit", limit=20, window_seconds=60))],
)
def post_deliverable(
    claim_id: int,
    payload: DeliverableCreate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    return submit_deliverable(session, actor_id=actor_id, claim_id=claim_id, payload=payload)


@app.post(
    "/deliverables/{deliverable_id}/accept",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.ACCEPTOR))],
)
def post_acceptance(
    deliverable_id: int,
    payload: AcceptanceCreate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    return accept_deliverable(
        session,
        actor_id=actor_id,
        deliverable_id=deliverable_id,
        result=payload.result,
        comment=payload.comment,
    )


@app.get(
    "/deliverables/pending-acceptance/mine",
    response_model=list[PendingAcceptanceRead],
    dependencies=[Depends(require_roles(Role.ADMIN, Role.ACCEPTOR))],
)
def get_pending_acceptance_mine(
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> list[PendingAcceptanceRead]:
    return list_my_pending_acceptance(session, user_id=actor_id)


@app.get("/rewards", response_model=list[RewardRead])
def get_rewards(
    user_id: int | None = Query(default=None),
    status: str | None = Query(default=None),
    held_only: bool = Query(default=False),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=200),
    session: Session = Depends(get_session),
) -> list[RewardRead]:
    parsed_status = None
    if status:
        try:
            parsed_status = RewardStatus(status)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="鏃犳晥鐨?reward status") from exc
    return list_rewards(
        session,
        user_id=user_id,
        status=parsed_status,
        held_only=held_only,
        offset=offset,
        limit=limit,
    )


@app.post(
    "/rewards/{reward_id}/confirm",
    response_model=RewardRead,
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER))],
)
def post_reward_confirm(
    reward_id: int,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> RewardRead:
    roles = get_user_roles(session, actor_id)
    return confirm_reward(session, actor_id=actor_id, actor_roles=roles, reward_id=reward_id)


@app.get("/knowledge")
def get_knowledge(
    keyword: str | None = Query(default=None),
    scenario: str | None = Query(default=None),
    level: str | None = Query(default=None),
    recommended: bool | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=200),
    session: Session = Depends(get_session),
) -> list[dict]:
    return list_knowledge(
        session,
        keyword=keyword,
        scenario=scenario,
        level=level,
        recommended=recommended,
        offset=offset,
        limit=limit,
    )


@app.get("/knowledge/{knowledge_id}")
def get_knowledge_item(
    knowledge_id: int,
    session: Session = Depends(get_session),
) -> dict:
    return get_knowledge_detail(session, knowledge_id)


@app.get(
    "/operations/logs",
    response_model=list[OperationLogRead],
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER))],
)
def get_operation_logs(
    action: str | None = Query(default=None),
    actor_user_id: int | None = Query(default=None),
    created_from: date | None = Query(default=None),
    created_to: date | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    session: Session = Depends(get_session),
) -> list[OperationLogRead]:
    return list_operation_logs(
        session=session,
        action=action,
        actor_user_id=actor_user_id,
        created_from=created_from,
        created_to=created_to,
        limit=limit,
    )


@app.get("/departments", response_model=list[DepartmentRead])
def get_departments(
    session: Session = Depends(get_session),
    _: int = Depends(require_roles(Role.ADMIN, Role.REVIEWER, Role.ACCEPTOR)),
) -> list[DepartmentRead]:
    return list_synced_departments(session)


@app.get("/dashboard/overview")
def get_dashboard_overview(session: Session = Depends(get_session)) -> dict:
    return dashboard_overview(session).model_dump()


@app.get("/dashboard/rankings", response_model=DashboardRankings)
def get_dashboard_rankings(
    time_range: TimeRange = Query(default="this_month"),
    top_n: int = Query(default=10, ge=1, le=100),
    session: Session = Depends(get_session),
) -> DashboardRankings:
    return dashboard_rankings(session, time_range=time_range, top_n=top_n)


@app.get("/dashboard/trends", response_model=DashboardTrends)
def get_dashboard_trends(
    time_range: TimeRange = Query(default="this_month"),
    granularity: TrendGranularity = Query(default="month"),
    session: Session = Depends(get_session),
) -> DashboardTrends:
    return dashboard_trends(session, time_range=time_range, granularity=granularity)


@app.get("/dashboard/distribution", response_model=DashboardDistribution)
def get_dashboard_distribution(
    time_range: TimeRange = Query(default="all"),
    session: Session = Depends(get_session),
) -> DashboardDistribution:
    return dashboard_distribution(session, time_range=time_range)


@app.get(
    "/exports/dashboard.xlsx",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER, Role.ACCEPTOR))],
)
def get_export_dashboard_xlsx(
    time_range: TimeRange = Query(default="this_month"),
    granularity: TrendGranularity = Query(default="month"),
    top_n: int = Query(default=10, ge=1, le=100),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    payload = export_dashboard_excel(session, time_range=time_range, granularity=granularity, top_n=top_n)
    return StreamingResponse(
        iter([payload]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=dashboard_export.xlsx"},
    )


@app.get(
    "/exports/rewards.xlsx",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER, Role.ACCEPTOR))],
)
def get_export_rewards_xlsx(session: Session = Depends(get_session)) -> StreamingResponse:
    payload = export_rewards_excel(session)
    return StreamingResponse(
        iter([payload]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=rewards_export.xlsx"},
    )


@app.get(
    "/exports/tasks.xlsx",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER, Role.ACCEPTOR))],
)
def get_export_tasks_xlsx(session: Session = Depends(get_session)) -> StreamingResponse:
    payload = export_tasks_excel(session)
    return StreamingResponse(
        iter([payload]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=tasks_export.xlsx"},
    )


@app.get(
    "/exports/knowledge.xlsx",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER, Role.ACCEPTOR))],
)
def get_export_knowledge_xlsx(session: Session = Depends(get_session)) -> StreamingResponse:
    payload = export_knowledge_excel(session)
    return StreamingResponse(
        iter([payload]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=knowledge_export.xlsx"},
    )


@app.get(
    "/exports/knowledge.pdf",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER, Role.ACCEPTOR))],
)
def get_export_knowledge_pdf(session: Session = Depends(get_session)) -> StreamingResponse:
    payload = export_knowledge_pdf(session)
    return StreamingResponse(
        iter([payload]),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=knowledge_export.pdf"},
    )


@app.get(
    "/system/config/overview",
    response_model=SystemConfigOverviewRead,
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER, Role.ACCEPTOR))],
)
def get_system_config_overview(session: Session = Depends(get_session)) -> SystemConfigOverviewRead:
    return SystemConfigOverviewRead(
        feishu_sync_frequency_minutes=get_sync_frequency_minutes(session),
        release_overdue_frequency_minutes=get_release_overdue_frequency_minutes(session),
        claim_approval_overdue_threshold=get_claim_approval_overdue_threshold(session),
        acceptance_templates=get_acceptance_templates(session),
    )


@app.get(
    "/system/config/feishu-sync-frequency",
    response_model=SyncFrequencyConfig,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def get_feishu_sync_frequency(session: Session = Depends(get_session)) -> SyncFrequencyConfig:
    return SyncFrequencyConfig(frequency_minutes=get_sync_frequency_minutes(session))


@app.put(
    "/system/config/feishu-sync-frequency",
    response_model=SyncFrequencyConfig,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def put_feishu_sync_frequency(
    payload: SyncFrequencyConfig,
    session: Session = Depends(get_session),
) -> SyncFrequencyConfig:
    value = set_sync_frequency_minutes(session, payload.frequency_minutes)
    return SyncFrequencyConfig(frequency_minutes=value)


@app.get(
    "/system/config/release-overdue-frequency",
    response_model=SyncFrequencyConfig,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def get_release_overdue_frequency(session: Session = Depends(get_session)) -> SyncFrequencyConfig:
    return SyncFrequencyConfig(frequency_minutes=get_release_overdue_frequency_minutes(session))


@app.put(
    "/system/config/release-overdue-frequency",
    response_model=SyncFrequencyConfig,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def put_release_overdue_frequency(
    payload: SyncFrequencyConfig,
    session: Session = Depends(get_session),
) -> SyncFrequencyConfig:
    value = set_release_overdue_frequency_minutes(session, payload.frequency_minutes)
    return SyncFrequencyConfig(frequency_minutes=value)


@app.get(
    "/system/config/claim-approval-overdue-threshold",
    response_model=ClaimApprovalThresholdConfig,
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER))],
)
def get_claim_approval_threshold(session: Session = Depends(get_session)) -> ClaimApprovalThresholdConfig:
    return ClaimApprovalThresholdConfig(threshold=get_claim_approval_overdue_threshold(session))


@app.put(
    "/system/config/claim-approval-overdue-threshold",
    response_model=ClaimApprovalThresholdConfig,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def put_claim_approval_threshold(
    payload: ClaimApprovalThresholdConfig,
    session: Session = Depends(get_session),
) -> ClaimApprovalThresholdConfig:
    value = set_claim_approval_overdue_threshold(session, payload.threshold)
    return ClaimApprovalThresholdConfig(threshold=value)


@app.get(
    "/system/config/acceptance-templates",
    response_model=AcceptanceTemplatesConfig,
    dependencies=[Depends(require_roles(Role.ADMIN, Role.ACCEPTOR, Role.REVIEWER))],
)
def get_acceptance_template_config(session: Session = Depends(get_session)) -> AcceptanceTemplatesConfig:
    return get_acceptance_templates(session)


@app.put(
    "/system/config/acceptance-templates",
    response_model=AcceptanceTemplatesConfig,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def put_acceptance_template_config(
    payload: AcceptanceTemplatesConfig,
    session: Session = Depends(get_session),
) -> AcceptanceTemplatesConfig:
    return set_acceptance_templates(session, payload)


@app.post(
    "/integrations/feishu/sync",
    response_model=FeishuSyncResult,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def post_feishu_sync(
    mode: str = Query(default="all", pattern="^(all|users|departments)$"),
    session: Session = Depends(get_session),
    provider=Depends(get_feishu_provider),
) -> FeishuSyncResult:
    return run_feishu_sync(session, provider=provider, mode=mode)


@app.post(
    "/jobs/release-overdue",
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER))],
)
def post_release_overdue(
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    return release_overdue_claims(session, actor_id=actor_id)

