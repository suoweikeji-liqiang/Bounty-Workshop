from __future__ import annotations

from datetime import datetime
from decimal import ROUND_HALF_UP

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlmodel import Session, select

from app.enums import ProblemStatus, RewardRoleType, RewardStatus
from app.models import Claim, ClaimMember, Deliverable, Knowledge, Problem, Reward, Task
from app.schemas import RewardRead
from app.services_common import (
    _cents_to_amount,
    _decimal,
    _from_json_list,
    _log,
    _money_to_cents,
    _to_json,
)


def _reward_to_read(reward: Reward) -> RewardRead:
    return RewardRead(
        id=reward.id,
        task_id=reward.task_id,
        user_id=reward.user_id,
        role_type=reward.role_type.value,
        amount=reward.amount,
        points=reward.points,
        badge=reward.badge,
        status=reward.status.value,
        confirmed_at=reward.confirmed_at,
    )


def _knowledge_to_dict(item: Knowledge) -> dict:
    tags = [str(tag) for tag in _from_json_list(item.tags)]
    scenario = tags[0] if len(tags) > 0 else None
    level = tags[1] if len(tags) > 1 else None
    return {
        "id": item.id,
        "task_id": item.task_id,
        "problem_summary": item.problem_summary,
        "solution_summary": item.solution_summary,
        "tags": tags,
        "scenario": scenario,
        "level": level,
        "recommended": item.recommended,
        "archived_at": item.archived_at,
    }


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _generate_rewards_and_knowledge(session: Session, task: Task, claim: Claim, deliverable: Deliverable) -> None:
    existing = session.exec(select(Reward).where(Reward.task_id == task.id)).first()
    if existing is not None:
        return

    problem = session.get(Problem, task.problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="问题不存在")

    total_reward = _decimal(task.reward_total)
    proposer_ratio = _decimal(task.proposer_ratio)
    total_cents = _money_to_cents(total_reward)
    proposer_cents = _money_to_cents(total_reward * proposer_ratio)
    proposer_cents = max(0, min(proposer_cents, total_cents))
    executors_total_cents = total_cents - proposer_cents

    session.add(
        Reward(
            task_id=task.id,
            user_id=problem.submitter_id,
            role_type=RewardRoleType.PROPOSER,
            amount=_cents_to_amount(proposer_cents),
        )
    )

    members = session.exec(select(ClaimMember).where(ClaimMember.claim_id == claim.id)).all()
    if not members:
        members = [ClaimMember(claim_id=claim.id, user_id=claim.lead_user_id, ratio=1.0)]

    ordered_indexes = sorted(
        range(len(members)),
        key=lambda idx: (
            _decimal(members[idx].ratio),
            -int(members[idx].user_id or 0),
        ),
        reverse=True,
    )
    member_cents: list[int] = []
    for member in members:
        ratio_decimal = _decimal(member.ratio)
        raw_cents = _decimal(executors_total_cents) * ratio_decimal
        member_cents.append(
            int(raw_cents.to_integral_value(rounding=ROUND_HALF_UP))
        )

    diff = executors_total_cents - sum(member_cents)
    if member_cents and diff != 0:
        step = 1 if diff > 0 else -1
        cursor = 0
        while diff != 0:
            target_idx = ordered_indexes[cursor % len(ordered_indexes)]
            if step < 0 and member_cents[target_idx] <= 0:
                cursor += 1
                continue
            member_cents[target_idx] += step
            diff -= step
            cursor += 1

    for idx, member in enumerate(members):
        amount = _cents_to_amount(member_cents[idx])
        session.add(
            Reward(
                task_id=task.id,
                user_id=member.user_id,
                role_type=RewardRoleType.EXECUTOR,
                amount=amount,
                points=task.points,
                badge=task.badge,
            )
        )

    if session.exec(select(Knowledge).where(Knowledge.task_id == task.id)).first() is None:
        knowledge = Knowledge(
            task_id=task.id,
            problem_summary=f"{problem.title} | {problem.description[:120]}",
            solution_summary=f"{task.goal} | {deliverable.summary[:200]}",
            tags=_to_json([problem.scenario.value, task.level.value]),
            recommended=False,
        )
        session.add(knowledge)

    problem.status = ProblemStatus.ARCHIVED


def list_rewards(
    session: Session,
    user_id: int | None = None,
    status: RewardStatus | None = None,
    offset: int = 0,
    limit: int = 200,
) -> list[RewardRead]:
    statement = select(Reward)
    if user_id is not None:
        statement = statement.where(Reward.user_id == user_id)
    if status is not None:
        statement = statement.where(Reward.status == status)
    safe_offset = max(offset, 0)
    safe_limit = max(1, min(limit, 200))
    rows = session.exec(
        statement.order_by(Reward.created_at.desc()).offset(safe_offset).limit(safe_limit)
    ).all()
    return [_reward_to_read(row) for row in rows]


def confirm_reward(
    session: Session,
    actor_id: int,
    reward_id: int,
) -> RewardRead:
    reward = session.get(Reward, reward_id)
    if reward is None:
        raise HTTPException(status_code=404, detail="激励记录不存在")
    if reward.status == RewardStatus.CONFIRMED:
        raise HTTPException(status_code=400, detail="该激励已确认，不可重复操作")
    reward.status = RewardStatus.CONFIRMED
    reward.confirmed_at = datetime.utcnow()
    _log(
        session,
        actor_id,
        "reward.confirm",
        "reward",
        reward_id,
        {"task_id": reward.task_id},
    )
    session.commit()
    session.refresh(reward)
    return _reward_to_read(reward)


def list_knowledge(
    session: Session,
    keyword: str | None = None,
    scenario: str | None = None,
    level: str | None = None,
    recommended: bool | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[dict]:
    statement = select(Knowledge)
    if keyword:
        needle = keyword.strip().lower()
        if needle:
            escaped = _escape_like(needle)
            like_value = f"%{escaped}%"
            statement = statement.where(
                or_(
                    func.lower(Knowledge.problem_summary).like(like_value, escape="\\"),
                    func.lower(Knowledge.solution_summary).like(like_value, escape="\\"),
                    func.lower(Knowledge.tags).like(like_value, escape="\\"),
                )
            )
    if scenario:
        statement = statement.where(Knowledge.tags.like(f'%"{_escape_like(scenario)}"%', escape="\\"))
    if level:
        statement = statement.where(Knowledge.tags.like(f'%"{_escape_like(level)}"%', escape="\\"))
    if recommended is not None:
        statement = statement.where(Knowledge.recommended == recommended)

    safe_offset = max(offset, 0)
    safe_limit = max(min(limit, 200), 1)
    rows = session.exec(
        statement.order_by(Knowledge.archived_at.desc()).offset(safe_offset).limit(safe_limit)
    ).all()
    return [_knowledge_to_dict(item) for item in rows]


def get_knowledge_detail(session: Session, knowledge_id: int) -> dict:
    item = session.get(Knowledge, knowledge_id)
    if item is None:
        raise HTTPException(status_code=404, detail="知识条目不存在")
    return _knowledge_to_dict(item)
