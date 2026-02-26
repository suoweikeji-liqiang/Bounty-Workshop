from __future__ import annotations

import json
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException
from sqlmodel import Session, select

from app.enums import Role, UserStatus
from app.models import OperationLog, User, UserRole
from app.schemas import UserRead

CLAIM_APPROVAL_OVERDUE_THRESHOLD_KEY = "claim_approval_overdue_threshold"
DEFAULT_CLAIM_APPROVAL_OVERDUE_THRESHOLD = 2
MIN_CLAIM_APPROVAL_OVERDUE_THRESHOLD = 1
MAX_ACTIVE_CLAIMS_PER_USER = 2


def _to_json(data: object) -> str:
    return json.dumps(data, ensure_ascii=False)


def _from_json(data: str) -> object:
    return json.loads(data)


def _from_json_list(data: str) -> list:
    try:
        parsed = _from_json(data)
    except Exception:
        return []
    return parsed if isinstance(parsed, list) else []


def _from_json_dict(data: str) -> dict:
    try:
        parsed = _from_json(data)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _decimal(value: float | int | str | Decimal) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value))


def _money_to_cents(value: Decimal) -> int:
    normalized = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int((normalized * 100).to_integral_value(rounding=ROUND_HALF_UP))


def _cents_to_amount(value: int) -> float:
    return float((Decimal(value) / Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _log(
    session: Session,
    actor_user_id: int | None,
    action: str,
    target_type: str,
    target_id: int | None,
    detail: dict,
) -> None:
    session.add(
        OperationLog(
            actor_user_id=actor_user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            detail=_to_json(detail),
        )
    )


def _ensure_user_exists(session: Session, user_id: int, allow_disabled: bool = False) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"user {user_id} not found")
    if not allow_disabled and user.status == UserStatus.DISABLED:
        raise HTTPException(status_code=403, detail=f"user {user_id} is disabled")
    return user


def _ensure_role(session: Session, user_id: int, role: Role) -> None:
    exists = session.exec(
        select(UserRole).where(UserRole.user_id == user_id, UserRole.role == role)
    ).first()
    if exists is None:
        raise HTTPException(status_code=400, detail=f"用户 {user_id} 未被授予 {role.value} 角色")


def user_to_read(session: Session, user: User) -> UserRead:
    roles = session.exec(select(UserRole).where(UserRole.user_id == user.id)).all()
    return UserRead(
        id=user.id,
        name=user.name,
        employee_no=user.employee_no,
        department=user.department,
        email=user.email,
        status=user.status.value,
        overdue_count=user.overdue_count,
        roles=[row.role for row in roles],
        has_password=bool(user.password_hash),
    )
