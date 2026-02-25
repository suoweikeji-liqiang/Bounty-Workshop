import base64
import hashlib
import hmac
import json
import os
import time

from fastapi import Depends, Header, HTTPException
from sqlmodel import Session, select

from app.db import get_session
from app.enums import Role, UserStatus
from app.models import User, UserRole

DEFAULT_AUTH_TOKEN_TTL_MINUTES = 24 * 60


def _is_production_env() -> bool:
    return os.getenv('APP_ENV', '').strip().lower() in {'prod', 'production'}


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {'1', 'true', 'yes', 'on'}


def is_passwordless_login_enabled() -> bool:
    # In production, disable by default unless explicitly turned on.
    default = not _is_production_env()
    return _env_flag('AUTH_ENABLE_PASSWORDLESS_LOGIN', default)


def is_header_user_auth_enabled() -> bool:
    # In production, disable by default unless explicitly turned on.
    default = not _is_production_env()
    return _env_flag('AUTH_ENABLE_HEADER_USER_ID', default)


def _token_secret() -> bytes:
    secret = os.getenv('AUTH_TOKEN_SECRET')
    if not secret:
        if _is_production_env():
            raise RuntimeError(
                "AUTH_TOKEN_SECRET must be set in production. "
                "Refusing to start with default secret."
            )
        secret = 'bounty-workshop-dev-secret'
    return secret.encode('utf-8')


def _token_ttl_seconds() -> int:
    raw = os.getenv('AUTH_TOKEN_TTL_MINUTES')
    if raw is None:
        return DEFAULT_AUTH_TOKEN_TTL_MINUTES * 60
    try:
        minutes = int(raw)
    except ValueError:
        minutes = DEFAULT_AUTH_TOKEN_TTL_MINUTES
    return max(minutes, 1) * 60


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode('utf-8').rstrip('=')


def _b64url_decode(raw: str) -> bytes:
    padding = '=' * (-len(raw) % 4)
    return base64.urlsafe_b64decode(raw + padding)


def _sign(payload_b64: str) -> str:
    digest = hmac.new(_token_secret(), payload_b64.encode('utf-8'), hashlib.sha256).digest()
    return _b64url_encode(digest)


def create_access_token(user_id: int, expires_in: int | None = None) -> tuple[str, int]:
    ttl_seconds = _token_ttl_seconds() if expires_in is None else max(expires_in, 1)
    now = int(time.time())
    payload = {
        'uid': user_id,
        'exp': now + ttl_seconds,
        'iat': now,
    }
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(',', ':')).encode('utf-8'))
    signature = _sign(payload_b64)
    return f'{payload_b64}.{signature}', ttl_seconds


def parse_access_token(token: str) -> int:
    parts = token.strip().split('.')
    if len(parts) != 2:
        raise HTTPException(status_code=401, detail='invalid access token format')
    payload_b64, signature = parts
    expected_signature = _sign(payload_b64)
    if not hmac.compare_digest(signature, expected_signature):
        raise HTTPException(status_code=401, detail='invalid access token signature')

    try:
        payload_raw = _b64url_decode(payload_b64).decode('utf-8')
        payload = json.loads(payload_raw)
    except Exception as exc:
        raise HTTPException(status_code=401, detail='invalid access token payload') from exc

    exp = payload.get('exp')
    uid = payload.get('uid')
    if not isinstance(exp, int) or exp < int(time.time()):
        raise HTTPException(status_code=401, detail='access token expired')
    if not isinstance(uid, int) or uid <= 0:
        raise HTTPException(status_code=401, detail='invalid access token user')
    return uid


def get_current_user_id(
    x_user_id: int | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> int:
    if authorization:
        prefix = 'bearer '
        if authorization.lower().startswith(prefix):
            token = authorization[len(prefix) :].strip()
            if token:
                return parse_access_token(token)
        raise HTTPException(status_code=401, detail='invalid Authorization header')

    if not is_header_user_auth_enabled():
        raise HTTPException(status_code=401, detail='Authorization header required')

    if x_user_id is None:
        raise HTTPException(status_code=401, detail='missing X-User-Id header')
    return x_user_id


def check_password_expiry(user: User) -> None:
    """检查密码是否过期（90天）"""
    from datetime import datetime, timedelta
    
    if not user.password_hash:
        return  # 飞书登录用户无需检查
    
    if not user.password_changed_at:
        # 如果从未修改过密码，认为过期
        raise HTTPException(
            status_code=403,
            detail="密码已过期，请修改密码后继续使用"
        )
    
    PASSWORD_EXPIRY_DAYS = 90
    expiry_date = user.password_changed_at + timedelta(days=PASSWORD_EXPIRY_DAYS)
    
    if datetime.utcnow() > expiry_date:
        raise HTTPException(
            status_code=403,
            detail=f"密码已超过{PASSWORD_EXPIRY_DAYS}天未修改，请修改密码后继续使用"
        )


def get_user_roles(session: Session, user_id: int) -> set[Role]:
    user = session.get(User, user_id)
    if user is None or user.status == UserStatus.DISABLED:
        raise HTTPException(status_code=403, detail='user not found or disabled')
    
    # 检查密码过期（仅对有密码的用户）
    check_password_expiry(user)
    
    role_rows = session.exec(select(UserRole).where(UserRole.user_id == user_id)).all()
    return {row.role for row in role_rows}


def require_roles(*allowed: Role):
    def checker(
        user_id: int = Depends(get_current_user_id),
        session: Session = Depends(get_session),
    ) -> int:
        roles = get_user_roles(session, user_id)
        if not any(role in roles for role in allowed):
            raise HTTPException(status_code=403, detail='permission denied')
        return user_id

    return checker
