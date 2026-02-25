import asyncio
import logging
import secrets as _secrets

from contextlib import suppress
from contextlib import asynccontextmanager
from datetime import date
import os

from fastapi import BackgroundTasks, Depends, FastAPI, File, Query, UploadFile, Request
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from sqlmodel import Session, select
import bcrypt

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
from app.auth import create_access_token, get_current_user_id, get_user_roles, require_roles
from app.db import engine, get_session, init_db
from app.enums import (
    AnalysisStatus,
    ClaimApprovalStatus,
    ProblemStatus,
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
from app.ai_models import (
    create_ai_model,
    decrypt_api_key,
    delete_ai_model,
    get_ai_model,
    list_ai_models,
    update_ai_model,
)
from app.prodmind import get_analysis_report
from app.rate_limit import rate_limit
from app.models import Problem, User, UserRole
from app.schemas import (
    AcceptanceCreate,
    AdminLoginRequest,
    ChangePasswordRequest,
    SetPasswordRequest,
    ClaimApprovalThresholdConfig,
    ClaimApprovalRequestRead,
    ClaimApprovalReviewInput,
    AcceptanceTemplatesConfig,
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
    PendingAcceptanceRead,
    ProblemCreate,
    ProblemDetailRead,
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
    AIModelCreate,
    AIModelUpdate,
    AIModelRead,
    HypothesisVerificationUpdate,
    ProblemReviewAnalysisRefCreate,
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
    get_problem_detail,
    get_claim_execution_detail,
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
    resubmit_problem,
    review_problem,
    set_user_roles,
    set_user_status,
    set_claim_approval_overdue_threshold,
    submit_deliverable,
    list_claim_approval_requests,
    trigger_problem_analysis,
    get_problem_analysis,
    list_hypothesis_verifications,
    update_hypothesis_verification,
    create_analysis_ref,
)

_logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    with Session(engine) as session:
        existing = session.exec(select(User).where(User.id == 1)).first()
        if existing is None:
            init_password = os.getenv("INIT_ADMIN_PASSWORD")
            if not init_password:
                init_password = _secrets.token_urlsafe(16)
            password_hash = bcrypt.hashpw(
                init_password.encode(), bcrypt.gensalt()
            ).decode()
            admin = User(
                name="系统管理员",
                employee_no="admin",
                department="平台部",
                password_hash=password_hash,
                force_password_change=True,
            )
            session.add(admin)
            session.flush()
            for role in [Role.ADMIN, Role.REVIEWER, Role.ACCEPTOR, Role.EMPLOYEE]:
                session.add(UserRole(user_id=admin.id, role=role))
            session.commit()
            if os.getenv("INIT_ADMIN_PASSWORD"):
                print("[INFO] 初始管理员已创建，使用环境变量指定的密码")
            else:
                print(f"[WARN] 初始管理员已创建，随机密码: {init_password}")
            print("   用户名: admin")
            print("   请登录后立即修改密码！")
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


app = FastAPI(title="揭榜挂帅任务管理系统 MVP", version="0.1.0", lifespan=lifespan)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    try:
        print(f"[REQ] {request.method} {request.url}")
        response = await call_next(request)
        print(f"[RESP] {response.status_code}")
        return response
    except Exception as e:
        print(f"[ERROR] Error processing request: {e}")
        raise

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


@app.exception_handler(Exception)
async def _global_exception_handler(request: Request, exc: Exception):
    _logger.exception("Unhandled exception on %s %s", request.method, request.url)
    return JSONResponse(status_code=500, content={"detail": "服务器内部错误"})


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/auth/login", response_model=AuthLoginResponse)
def post_login(
    payload: dict,
    session: Session = Depends(get_session),
) -> AuthLoginResponse:
    """简单登录 - 根据 user_id 返回 token（仅开发/测试环境可用）"""
    from app.auth import create_access_token, is_passwordless_login_enabled
    from app.services import user_to_read
    
    if not is_passwordless_login_enabled():
        raise HTTPException(status_code=403, detail="密码登录已禁用")
    
    user_id = payload.get("user_id")
    if user_id is None:
        raise HTTPException(status_code=400, detail="user_id is required")
    
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    access_token, expires_in = create_access_token(user_id)
    
    return AuthLoginResponse(
        access_token=access_token,
        expires_in=expires_in,
        user=user_to_read(session, user),
    )


@app.post("/auth/admin/login", response_model=AuthLoginResponse)
def post_admin_login(
    payload: AdminLoginRequest,
    session: Session = Depends(get_session),
) -> AuthLoginResponse:
    """管理员账号密码登录（含失败次数限制）"""
    from datetime import datetime, timedelta
    
    # 查找用户（支持employee_no或email）
    user = session.exec(
        select(User).where(
            (User.employee_no == payload.username) | (User.email == payload.username)
        )
    ).first()
    
    if user is None:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    
    # 检查账号锁定状态
    if user.locked_until and user.locked_until > datetime.utcnow():
        remaining = int((user.locked_until - datetime.utcnow()).total_seconds() / 60)
        raise HTTPException(
            status_code=403, 
            detail=f"账号已被锁定，请{remaining}分钟后再试"
        )
    
    # 检查用户状态
    if user.status == UserStatus.DISABLED:
        raise HTTPException(status_code=403, detail="账号已被禁用")
    
    # 验证密码
    if not user.password_hash:
        raise HTTPException(status_code=401, detail="该账号未设置密码，请使用飞书登录")
    
    password_valid = bcrypt.checkpw(payload.password.encode(), user.password_hash.encode())
    
    if not password_valid:
        # 登录失败：增加失败次数
        user.failed_login_attempts += 1
        
        # 超过5次失败，锁定账号30分钟
        MAX_ATTEMPTS = 5
        LOCKOUT_MINUTES = 30
        
        if user.failed_login_attempts >= MAX_ATTEMPTS:
            user.locked_until = datetime.utcnow() + timedelta(minutes=LOCKOUT_MINUTES)

            # 记录审计日志
            _log_auth_event(session, user.id, "login_locked", {
                "username": payload.username,
                "failed_attempts": user.failed_login_attempts,
                "locked_until": user.locked_until.isoformat()
            })
            session.add(user)
            session.commit()
            
            raise HTTPException(
                status_code=403,
                detail=f"登录失败次数过多，账号已被锁定{LOCKOUT_MINUTES}分钟"
            )
        
        # 记录失败日志
        _log_auth_event(session, user.id, "login_failed", {
            "username": payload.username,
            "failed_attempts": user.failed_login_attempts,
            "remaining_attempts": MAX_ATTEMPTS - user.failed_login_attempts
        })
        session.add(user)
        session.commit()
        
        raise HTTPException(
            status_code=401,
            detail=f"用户名或密码错误，剩余尝试次数：{MAX_ATTEMPTS - user.failed_login_attempts}"
        )
    
    # 检查是否为管理员
    user_roles = session.exec(select(UserRole).where(UserRole.user_id == user.id)).all()
    roles = [ur.role for ur in user_roles]
    if Role.ADMIN not in roles:
        raise HTTPException(status_code=403, detail="该账号无管理员权限")
    
    # 登录成功：清除失败次数和锁定状态
    user.failed_login_attempts = 0
    user.locked_until = None

    # 记录成功登录日志
    _log_auth_event(session, user.id, "login_success", {
        "username": payload.username,
        "roles": [r.value for r in roles]
    })
    session.add(user)
    session.commit()
    
    # 检查是否需要强制修改密码
    response_user = get_my_profile(session, user.id)
    if user.force_password_change:
        response_user.__dict__['force_password_change'] = True  # 临时添加标记
    
    access_token, expires_in = create_access_token(user.id)
    return AuthLoginResponse(
        access_token=access_token,
        expires_in=expires_in,
        user=response_user,
    )


def _log_auth_event(session: Session, user_id: int, event_type: str, details: dict) -> None:
    """记录认证审计日志"""
    from app.models import OperationLog
    from app.services import _to_json
    
    log = OperationLog(
        actor_user_id=user_id,
        action=f"auth.{event_type}",
        target_type="auth",
        target_id=user_id,
        detail=_to_json(details),
    )
    session.add(log)
    # 不在这里commit，由调用方统一commit


@app.get("/me", response_model=UserRead)
def get_me(
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> UserRead:
    return get_my_profile(session, actor_id)


@app.post("/me/password")
def change_my_password(
    payload: ChangePasswordRequest,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    """修改当前用户密码"""
    from datetime import datetime
    
    user = session.get(User, actor_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    # 验证旧密码
    if not user.password_hash:
        raise HTTPException(status_code=400, detail="该账号未设置密码")
    
    if not bcrypt.checkpw(payload.old_password.encode(), user.password_hash.encode()):
        raise HTTPException(status_code=401, detail="旧密码错误")
    
    # 设置新密码
    new_hash = bcrypt.hashpw(payload.new_password.encode(), bcrypt.gensalt()).decode()
    user.password_hash = new_hash
    user.password_changed_at = datetime.utcnow()
    user.force_password_change = False  # 清除强制修改标记
    
    session.add(user)
    session.commit()
    
    # 记录审计日志
    _log_auth_event(session, actor_id, "password_changed", {
        "changed_at": user.password_changed_at.isoformat()
    })
    session.commit()
    
    return {"message": "密码修改成功"}


@app.post("/admin/users/{user_id}/password")
def set_user_password(
    user_id: int,
    payload: SetPasswordRequest,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
    _roles: int = Depends(require_roles(Role.ADMIN)),
) -> dict:
    """管理员为用户设置密码"""
    from datetime import datetime

    target_user = session.get(User, user_id)
    if target_user is None:
        raise HTTPException(status_code=404, detail="目标用户不存在")
    
    # 生成密码哈希
    password_hash = bcrypt.hashpw(payload.new_password.encode(), bcrypt.gensalt()).decode()
    
    target_user.password_hash = password_hash
    target_user.password_changed_at = datetime.utcnow()
    target_user.force_password_change = payload.force_change
    target_user.failed_login_attempts = 0  # 重置失败次数
    target_user.locked_until = None  # 解除锁定
    
    session.add(target_user)
    session.commit()
    
    # 记录审计日志
    _log_auth_event(session, actor_id, "password_set_by_admin", {
        "target_user_id": target_user.id,
        "target_user_name": target_user.name,
        "force_change": payload.force_change
    })
    session.commit()
    
    return {
        "message": f"已为用户 {target_user.name} 设置密码",
        "force_change": payload.force_change
    }


@app.get("/me/summary", response_model=PersonalSummaryRead)
def get_me_summary(
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> PersonalSummaryRead:
    return get_my_summary(session, actor_id)


_MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_SIZE_MB", "50")) * 1024 * 1024


@app.post("/attachments/upload", response_model=AttachmentRead)
async def post_attachment_upload(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> AttachmentRead:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(256 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > _MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"文件大小超过限制 ({_MAX_UPLOAD_BYTES // (1024 * 1024)}MB)",
            )
        chunks.append(chunk)
    content = b"".join(chunks)
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
    ensure_attachment_access(session, actor_id, actor_roles, attachment)
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
    ensure_attachment_access(session, actor_id, actor_roles, attachment)
    if attachment.storage_backend == "s3":
        url = get_presigned_download_url(attachment, expires_in=expires_in)
        return RedirectResponse(url=url, status_code=307)
    if attachment.storage_backend != "local":
        raise HTTPException(status_code=501, detail="不支持的存储后端")
    file_path = local_file_path(attachment.object_key)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="附件文件不存在")
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
    ensure_attachment_access(session, actor_id, actor_roles, attachment)
    if attachment.storage_backend != "s3":
        raise HTTPException(status_code=400, detail="仅 s3 附件支持预签名")
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
        raise HTTPException(status_code=400, detail="entity_type 仅支持 problem 或 deliverable")
    actor_roles = get_user_roles(session, actor_id)
    ensure_entity_attachment_access(session, actor_id, actor_roles, entity_type, entity_id)
    return list_attachments_by_entity(session, entity_type=entity_type, entity_id=entity_id)


@app.post("/auth/logout")
def post_logout(
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    """用户登出（记录审计日志）"""
    user = session.get(User, actor_id)
    if user:
        _log_auth_event(session, actor_id, "logout", {
            "user_name": user.name,
            "employee_no": user.employee_no
        })
        session.commit()
    
    return {"message": "登出成功"}


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
def get_users_active(
    session: Session = Depends(get_session),
    _: int = Depends(get_current_user_id),
) -> list[UserRead]:
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
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> ProblemRead:
    problem = create_problem(session, actor_id=actor_id, payload=payload)
    background_tasks.add_task(_trigger_analysis_background, problem.id)
    return problem


@app.put("/problems/{problem_id}/resubmit", response_model=ProblemRead)
def put_problem_resubmit(
    problem_id: int,
    payload: ProblemCreate,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> ProblemRead:
    problem = resubmit_problem(session, actor_id=actor_id, problem_id=problem_id, payload=payload)
    background_tasks.add_task(_trigger_analysis_background, problem.id)
    return problem


def _trigger_analysis_background(problem_id: int) -> None:
    from app.services import trigger_problem_analysis
    try:
        with Session(engine) as session:
            asyncio.run(trigger_problem_analysis(session, problem_id))
    except Exception:
        _logger.exception("Background analysis failed for problem_id=%s", problem_id)


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


@app.get("/problems/{problem_id}", response_model=ProblemDetailRead)
def get_problem(
    problem_id: int,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> ProblemDetailRead:
    actor_roles = get_user_roles(session, actor_id)
    return get_problem_detail(session, actor_id=actor_id, actor_roles=actor_roles, problem_id=problem_id)


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
    _: int = Depends(get_current_user_id),
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
    _: int = Depends(get_current_user_id),
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
            raise HTTPException(status_code=400, detail="无效的 claim status") from exc
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
    dependencies=[Depends(require_roles(Role.ACCEPTOR))],
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
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=200),
    session: Session = Depends(get_session),
    _: int = Depends(get_current_user_id),
) -> list[RewardRead]:
    return list_rewards(session, user_id=user_id, offset=offset, limit=limit)


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
    return confirm_reward(session, actor_id=actor_id, reward_id=reward_id)


@app.get("/knowledge")
def get_knowledge(
    keyword: str | None = Query(default=None),
    scenario: str | None = Query(default=None),
    level: str | None = Query(default=None),
    recommended: bool | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=200),
    session: Session = Depends(get_session),
    _: int = Depends(get_current_user_id),
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
    _: int = Depends(get_current_user_id),
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
def get_dashboard_overview(
    session: Session = Depends(get_session),
    _: int = Depends(get_current_user_id),
) -> dict:
    return dashboard_overview(session).model_dump()


@app.get("/dashboard/rankings", response_model=DashboardRankings)
def get_dashboard_rankings(
    time_range: TimeRange = Query(default="this_month"),
    top_n: int = Query(default=10, ge=1, le=100),
    session: Session = Depends(get_session),
    _: int = Depends(get_current_user_id),
) -> DashboardRankings:
    return dashboard_rankings(session, time_range=time_range, top_n=top_n)


@app.get("/dashboard/trends", response_model=DashboardTrends)
def get_dashboard_trends(
    time_range: TimeRange = Query(default="this_month"),
    granularity: TrendGranularity = Query(default="month"),
    session: Session = Depends(get_session),
    _: int = Depends(get_current_user_id),
) -> DashboardTrends:
    return dashboard_trends(session, time_range=time_range, granularity=granularity)


@app.get("/dashboard/distribution", response_model=DashboardDistribution)
def get_dashboard_distribution(
    time_range: TimeRange = Query(default="all"),
    session: Session = Depends(get_session),
    _: int = Depends(get_current_user_id),
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


@app.get(
    "/ai/models",
    response_model=list[AIModelRead],
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def get_ai_models(session: Session = Depends(get_session)) -> list[AIModelRead]:
    models = list_ai_models(session)
    return [
        AIModelRead(
            id=m.id,
            name=m.name,
            provider=m.provider,
            api_base_url=m.api_base_url,
            has_api_key=bool(m.api_key_encrypted),
            model=m.model,
            is_default=m.is_default,
            enabled=m.enabled,
            max_tokens=m.max_tokens,
            temperature=m.temperature,
            timeout=m.timeout,
            created_at=m.created_at,
            updated_at=m.updated_at,
        )
        for m in models
    ]


@app.post(
    "/ai/models",
    response_model=AIModelRead,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def post_ai_model(
    payload: AIModelCreate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> AIModelRead:
    model = create_ai_model(session, actor_id, payload)
    return AIModelRead(
        id=model.id,
        name=model.name,
        provider=model.provider,
        api_base_url=model.api_base_url,
        has_api_key=bool(model.api_key_encrypted),
        model=model.model,
        is_default=model.is_default,
        enabled=model.enabled,
        max_tokens=model.max_tokens,
        temperature=model.temperature,
        timeout=model.timeout,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


@app.get(
    "/ai/models/{model_id}",
    response_model=AIModelRead,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def get_ai_model_detail(
    model_id: int,
    session: Session = Depends(get_session),
) -> AIModelRead:
    model = get_ai_model(session, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Model not found")
    return AIModelRead(
        id=model.id,
        name=model.name,
        provider=model.provider,
        api_base_url=model.api_base_url,
        has_api_key=bool(model.api_key_encrypted),
        model=model.model,
        is_default=model.is_default,
        enabled=model.enabled,
        max_tokens=model.max_tokens,
        temperature=model.temperature,
        timeout=model.timeout,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


@app.put(
    "/ai/models/{model_id}",
    response_model=AIModelRead,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def put_ai_model(
    model_id: int,
    payload: AIModelUpdate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> AIModelRead:
    model = update_ai_model(session, actor_id, model_id, payload)
    return AIModelRead(
        id=model.id,
        name=model.name,
        provider=model.provider,
        api_base_url=model.api_base_url,
        has_api_key=bool(model.api_key_encrypted),
        model=model.model,
        is_default=model.is_default,
        enabled=model.enabled,
        max_tokens=model.max_tokens,
        temperature=model.temperature,
        timeout=model.timeout,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


@app.delete(
    "/ai/models/{model_id}",
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def delete_ai_model_route(
    model_id: int,
    session: Session = Depends(get_session),
) -> dict:
    delete_ai_model(session, model_id)
    return {"message": "Model deleted"}


@app.get(
    "/ai/models/{model_id}/api-key",
    response_model=dict,
    dependencies=[Depends(require_roles(Role.ADMIN))],
)
def get_ai_model_api_key(
    model_id: int,
    session: Session = Depends(get_session),
) -> dict:
    model = get_ai_model(session, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Model not found")
    if not model.api_key_encrypted:
        raise HTTPException(status_code=404, detail="No API key configured")
    api_key = decrypt_api_key(model.api_key_encrypted)
    return {"api_key": api_key}


@app.post(
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


@app.get(
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


@app.get(
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


@app.put(
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


@app.post(
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
