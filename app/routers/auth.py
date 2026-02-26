from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi import HTTPException
from sqlmodel import Session, select
import bcrypt

from app.auth import create_access_token, get_current_user_id, get_user_roles, require_roles
from app.db import get_session
from app.enums import Role, UserStatus
from app.feishu import (
    consume_oauth_state,
    create_oauth_state,
    get_feishu_provider,
    login_by_feishu_code,
)
from app.models import OperationLog, User, UserRole
from app.schemas import (
    AdminLoginRequest,
    AuthLoginResponse,
    ChangePasswordRequest,
    FeishuLoginResult,
    FeishuLoginUrlResponse,
    SetPasswordRequest,
    UserRead,
)
from app.services import _to_json, get_my_profile, user_to_read

router = APIRouter(tags=["auth"])


def _log_auth_event(session: Session, user_id: int, event_type: str, details: dict) -> None:
    log = OperationLog(
        actor_user_id=user_id,
        action=f"auth.{event_type}",
        target_type="auth",
        target_id=user_id,
        detail=_to_json(details),
    )
    session.add(log)


@router.post("/auth/login", response_model=AuthLoginResponse)
def post_login(
    payload: dict,
    session: Session = Depends(get_session),
) -> AuthLoginResponse:
    from app.auth import is_passwordless_login_enabled

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


@router.post("/auth/admin/login", response_model=AuthLoginResponse)
def post_admin_login(
    payload: AdminLoginRequest,
    session: Session = Depends(get_session),
) -> AuthLoginResponse:
    from datetime import datetime, timedelta

    user = session.exec(
        select(User).where(
            (User.employee_no == payload.username) | (User.email == payload.username)
        )
    ).first()

    if user is None:
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    if user.locked_until and user.locked_until > datetime.utcnow():
        remaining = int((user.locked_until - datetime.utcnow()).total_seconds() / 60)
        raise HTTPException(status_code=403, detail=f"账号已被锁定，请{remaining}分钟后再试")

    if user.status == UserStatus.DISABLED:
        raise HTTPException(status_code=403, detail="账号已被禁用")

    if not user.password_hash:
        raise HTTPException(status_code=401, detail="该账号未设置密码，请使用飞书登录")

    password_valid = bcrypt.checkpw(payload.password.encode(), user.password_hash.encode())

    if not password_valid:
        user.failed_login_attempts += 1
        MAX_ATTEMPTS = 5
        LOCKOUT_MINUTES = 30

        if user.failed_login_attempts >= MAX_ATTEMPTS:
            user.locked_until = datetime.utcnow() + timedelta(minutes=LOCKOUT_MINUTES)
            _log_auth_event(session, user.id, "login_locked", {
                "username": payload.username,
                "failed_attempts": user.failed_login_attempts,
                "locked_until": user.locked_until.isoformat(),
            })
            session.add(user)
            session.commit()
            raise HTTPException(
                status_code=403,
                detail=f"登录失败次数过多，账号已被锁定{LOCKOUT_MINUTES}分钟",
            )

        _log_auth_event(session, user.id, "login_failed", {
            "username": payload.username,
            "failed_attempts": user.failed_login_attempts,
            "remaining_attempts": MAX_ATTEMPTS - user.failed_login_attempts,
        })
        session.add(user)
        session.commit()
        raise HTTPException(
            status_code=401,
            detail=f"用户名或密码错误，剩余尝试次数：{MAX_ATTEMPTS - user.failed_login_attempts}",
        )

    user_roles = session.exec(select(UserRole).where(UserRole.user_id == user.id)).all()
    roles = [ur.role for ur in user_roles]
    if Role.ADMIN not in roles:
        raise HTTPException(status_code=403, detail="该账号无管理员权限")

    user.failed_login_attempts = 0
    user.locked_until = None
    _log_auth_event(session, user.id, "login_success", {
        "username": payload.username,
        "roles": [r.value for r in roles],
    })
    session.add(user)
    session.commit()

    response_user = get_my_profile(session, user.id)
    if user.force_password_change:
        response_user.__dict__["force_password_change"] = True

    access_token, expires_in = create_access_token(user.id)
    return AuthLoginResponse(
        access_token=access_token,
        expires_in=expires_in,
        user=response_user,
    )


@router.post("/me/password")
def change_my_password(
    payload: ChangePasswordRequest,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    from datetime import datetime

    user = session.get(User, actor_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if not user.password_hash:
        raise HTTPException(status_code=400, detail="该账号未设置密码")
    if not bcrypt.checkpw(payload.old_password.encode(), user.password_hash.encode()):
        raise HTTPException(status_code=401, detail="旧密码错误")

    new_hash = bcrypt.hashpw(payload.new_password.encode(), bcrypt.gensalt()).decode()
    user.password_hash = new_hash
    user.password_changed_at = datetime.utcnow()
    user.force_password_change = False
    session.add(user)
    session.commit()

    _log_auth_event(session, actor_id, "password_changed", {
        "changed_at": user.password_changed_at.isoformat(),
    })
    session.commit()
    return {"message": "密码修改成功"}


@router.post("/admin/users/{user_id}/password")
def set_user_password(
    user_id: int,
    payload: SetPasswordRequest,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
    _roles: int = Depends(require_roles(Role.ADMIN)),
) -> dict:
    from datetime import datetime

    target_user = session.get(User, user_id)
    if target_user is None:
        raise HTTPException(status_code=404, detail="目标用户不存在")

    password_hash = bcrypt.hashpw(payload.new_password.encode(), bcrypt.gensalt()).decode()
    target_user.password_hash = password_hash
    target_user.password_changed_at = datetime.utcnow()
    target_user.force_password_change = payload.force_change
    target_user.failed_login_attempts = 0
    target_user.locked_until = None
    session.add(target_user)
    session.commit()

    _log_auth_event(session, actor_id, "password_set_by_admin", {
        "target_user_id": target_user.id,
        "target_user_name": target_user.name,
        "force_change": payload.force_change,
    })
    session.commit()
    return {"message": f"已为用户 {target_user.name} 设置密码", "force_change": payload.force_change}


@router.post("/auth/logout")
def post_logout(
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> dict:
    user = session.get(User, actor_id)
    if user:
        _log_auth_event(session, actor_id, "logout", {
            "user_name": user.name,
            "employee_no": user.employee_no,
        })
        session.commit()
    return {"message": "登出成功"}


@router.get("/auth/feishu/login-url", response_model=FeishuLoginUrlResponse)
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


@router.get("/auth/feishu/callback", response_model=FeishuLoginResult)
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
