from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.auth import get_current_user_id, require_roles
from app.db import get_session
from app.enums import Role
from app.schemas import RewardRead
from app.services import confirm_reward, get_knowledge_detail, list_knowledge, list_rewards

router = APIRouter(tags=["rewards"])


@router.get("/rewards", response_model=list[RewardRead])
def get_rewards(
    user_id: int | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=200),
    session: Session = Depends(get_session),
    _: int = Depends(get_current_user_id),
) -> list[RewardRead]:
    return list_rewards(session, user_id=user_id, offset=offset, limit=limit)


@router.post(
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


@router.get("/knowledge")
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


@router.get("/knowledge/{knowledge_id}")
def get_knowledge_item(
    knowledge_id: int,
    session: Session = Depends(get_session),
    _: int = Depends(get_current_user_id),
) -> dict:
    return get_knowledge_detail(session, knowledge_id)
