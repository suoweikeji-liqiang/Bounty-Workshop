from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.auth import get_current_user_id, require_roles
from app.db import get_session
from app.enums import Role
from app.schemas import (
    PersonalSummaryRead,
    RoleUpdate,
    UserCreate,
    UserRead,
    UserStatusUpdate,
)
from app.services import (
    create_user,
    get_my_profile,
    get_my_summary,
    get_user_detail,
    list_acceptor_candidates,
    list_active_users,
    list_users,
    set_user_roles,
    set_user_status,
)

router = APIRouter(tags=["users"])


@router.get("/me", response_model=UserRead)
def get_me(
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> UserRead:
    return get_my_profile(session, actor_id)


@router.get("/me/summary", response_model=PersonalSummaryRead)
def get_me_summary(
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> PersonalSummaryRead:
    return get_my_summary(session, actor_id)


@router.get("/users", response_model=list[UserRead], dependencies=[Depends(require_roles(Role.ADMIN))])
def get_users(session: Session = Depends(get_session)) -> list[UserRead]:
    return list_users(session)


@router.get("/users/active", response_model=list[UserRead])
def get_users_active(
    session: Session = Depends(get_session),
    _: int = Depends(get_current_user_id),
) -> list[UserRead]:
    return list_active_users(session)


@router.get(
    "/users/acceptors",
    response_model=list[UserRead],
    dependencies=[Depends(require_roles(Role.ADMIN, Role.REVIEWER))],
)
def get_users_acceptors(session: Session = Depends(get_session)) -> list[UserRead]:
    return list_acceptor_candidates(session)


@router.get("/users/{user_id}", response_model=UserRead, dependencies=[Depends(require_roles(Role.ADMIN))])
def get_user(
    user_id: int,
    session: Session = Depends(get_session),
) -> UserRead:
    return get_user_detail(session, user_id)


@router.post("/users", response_model=UserRead, dependencies=[Depends(require_roles(Role.ADMIN))])
def post_users(
    payload: UserCreate,
    session: Session = Depends(get_session),
    actor_id: int = Depends(get_current_user_id),
) -> UserRead:
    return create_user(session, actor_id=actor_id, payload=payload)


@router.put(
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


@router.put(
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
