from fastapi import Depends, Header, HTTPException
from sqlmodel import Session, select

from app.db import get_session
from app.enums import Role, UserStatus
from app.models import User, UserRole


def get_current_user_id(x_user_id: int | None = Header(default=None)) -> int:
    if x_user_id is None:
        raise HTTPException(status_code=401, detail="缺少 X-User-Id 请求头")
    return x_user_id


def get_user_roles(session: Session, user_id: int) -> set[Role]:
    user = session.get(User, user_id)
    if user is None or user.status == UserStatus.DISABLED:
        raise HTTPException(status_code=403, detail="用户不存在或已禁用")
    role_rows = session.exec(select(UserRole).where(UserRole.user_id == user_id)).all()
    return {row.role for row in role_rows}


def require_roles(*allowed: Role):
    def checker(
        user_id: int = Depends(get_current_user_id),
        session: Session = Depends(get_session),
    ) -> int:
        roles = get_user_roles(session, user_id)
        if not any(role in roles for role in allowed):
            raise HTTPException(status_code=403, detail="权限不足")
        return user_id

    return checker

