import asyncio
import logging
import secrets as _secrets

from contextlib import suppress
from contextlib import asynccontextmanager
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlmodel import Session, select
import bcrypt

from app.db import engine, init_db
from app.enums import Role
from app.jobs import (
    is_background_jobs_enabled,
    is_feishu_sync_job_enabled,
    run_feishu_sync_scheduler,
    run_release_overdue_scheduler,
    run_stale_progress_reminder_scheduler,
)
from app.models import User, UserRole
from app.routers import (
    attachments,
    auth,
    claims,
    milestones,
    problems,
    rewards,
    system,
    task_activities,
    tasks,
    users,
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
            for role in [Role.ADMIN, Role.REVIEWER, Role.REWARD_APPROVER, Role.ACCEPTOR, Role.EMPLOYEE]:
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
        scheduler_tasks.append(asyncio.create_task(
            run_stale_progress_reminder_scheduler(lambda: Session(engine), stop_event)
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
        if request.method == "OPTIONS":
            return await call_next(request)
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
        "*",
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


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(tasks.router)
app.include_router(task_activities.router)
app.include_router(milestones.router)
app.include_router(problems.router)
app.include_router(claims.router)
app.include_router(attachments.router)
app.include_router(rewards.router)
app.include_router(system.router)
