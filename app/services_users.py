from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import Session, select

from app.enums import RewardStatus, Role, UserStatus
from app.models import User, UserRole
from app.schemas import (
    PersonalRewardStats,
    PersonalSummaryRead,
    RoleUpdate,
    UserCreate,
    UserRead,
    UserStatusUpdate,
)
from app.services_common import _ensure_user_exists, _log, user_to_read


def create_user(session: Session, actor_id: int, payload: UserCreate) -> UserRead:
    user = User(
        name=payload.name,
        employee_no=payload.employee_no,
        department=payload.department,
        email=payload.email,
    )
    session.add(user)
    session.flush()

    roles = payload.roles or [Role.EMPLOYEE]
    for role in set(roles):
        session.add(UserRole(user_id=user.id, role=role))

    _log(
        session=session,
        actor_user_id=actor_id,
        action="user.create",
        target_type="user",
        target_id=user.id,
        detail={"name": payload.name, "roles": [r.value for r in roles]},
    )
    session.commit()
    session.refresh(user)
    return user_to_read(session, user)


def list_users(session: Session) -> list[UserRead]:
    users = session.exec(select(User).order_by(User.id)).all()
    return [user_to_read(session, item) for item in users]


def get_user_detail(session: Session, user_id: int) -> UserRead:
    user = _ensure_user_exists(session, user_id, allow_disabled=True)
    return user_to_read(session, user)


def list_active_users(session: Session) -> list[UserRead]:
    users = session.exec(
        select(User).where(User.status == UserStatus.ENABLED).order_by(User.id)
    ).all()
    return [user_to_read(session, item) for item in users]


def list_acceptor_candidates(session: Session) -> list[UserRead]:
    users = session.exec(
        select(User)
        .join(UserRole, UserRole.user_id == User.id)
        .where(UserRole.role == Role.ACCEPTOR, User.status == UserStatus.ENABLED)
        .order_by(User.id)
    ).all()
    return [user_to_read(session, item) for item in users]


def get_my_profile(session: Session, user_id: int) -> UserRead:
    user = _ensure_user_exists(session, user_id, allow_disabled=True)
    return user_to_read(session, user)


def get_my_summary(session: Session, user_id: int) -> PersonalSummaryRead:
    from app.services_rewards import list_rewards

    user = _ensure_user_exists(session, user_id, allow_disabled=True)
    rewards = list_rewards(session, user_id=user_id)
    confirmed_rewards = [item for item in rewards if item.status == RewardStatus.CONFIRMED.value]
    badges = sorted({item.badge for item in confirmed_rewards if item.badge})
    stats = PersonalRewardStats(
        total_records=len(rewards),
        confirmed_records=len(confirmed_rewards),
        confirmed_reward_amount=round(sum(item.amount for item in confirmed_rewards), 2),
        total_points=sum(item.points for item in rewards),
        confirmed_points=sum(item.points for item in confirmed_rewards),
    )
    return PersonalSummaryRead(
        user=user_to_read(session, user),
        stats=stats,
        badges=badges,
        rewards=rewards,
    )


def set_user_roles(session: Session, actor_id: int, user_id: int, payload: RoleUpdate) -> UserRead:
    _ensure_user_exists(session, user_id, allow_disabled=True)
    for role_row in session.exec(select(UserRole).where(UserRole.user_id == user_id)).all():
        session.delete(role_row)
    roles = payload.roles or [Role.EMPLOYEE]
    for role in set(roles):
        session.add(UserRole(user_id=user_id, role=role))
    _log(
        session=session,
        actor_user_id=actor_id,
        action="user.role.update",
        target_type="user",
        target_id=user_id,
        detail={"roles": [r.value for r in roles]},
    )
    session.commit()
    return user_to_read(session, _ensure_user_exists(session, user_id, allow_disabled=True))


def set_user_status(
    session: Session,
    actor_id: int,
    user_id: int,
    payload: UserStatusUpdate,
) -> UserRead:
    user = _ensure_user_exists(session, user_id, allow_disabled=True)
    user.status = payload.status
    _log(
        session=session,
        actor_user_id=actor_id,
        action="user.status.update",
        target_type="user",
        target_id=user_id,
        detail={"status": payload.status.value},
    )
    session.commit()
    session.refresh(user)
    return user_to_read(session, user)
