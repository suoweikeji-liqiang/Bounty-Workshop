from __future__ import annotations

from datetime import datetime

from sqlalchemy import func
from sqlmodel import Session, select

from app.enums import ClaimMode, ClaimStatus, ProblemStatus, RewardRoleType, RewardStatus, TaskLevel
from app.models import Claim, ClaimMember, Deliverable, Problem, Reward, Task, UserBadge

BADGE_DEFINITIONS: list[dict[str, object]] = [
    {
        'code': 'innovator',
        'name': '创新先锋',
        'category': 'task',
        'description': '完成 1 个 S 级任务',
        'icon': 'lightbulb',
        'auto_enabled': True,
    },
    {
        'code': 'problem_hunter',
        'name': '问题猎手',
        'category': 'submit',
        'description': '累计提交 10 个通过评审的问题',
        'icon': 'search',
        'auto_enabled': True,
    },
    {
        'code': 'speed_runner',
        'name': '效率达人',
        'category': 'speed',
        'description': '提前或准时完成 3 个任务',
        'icon': 'bolt',
        'auto_enabled': True,
    },
    {
        'code': 'team_player',
        'name': '协作之星',
        'category': 'team',
        'description': '参与 5 次团队揭榜并完成',
        'icon': 'handshake',
        'auto_enabled': True,
    },
    {
        'code': 'quality_king',
        'name': '质量标杆',
        'category': 'quality',
        'description': '连续高质量交付（当前为人工授予）',
        'icon': 'crown',
        'auto_enabled': False,
    },
    {
        'code': 'first_blood',
        'name': '首次揭榜',
        'category': 'milestone',
        'description': '首次完成任务',
        'icon': 'flag',
        'auto_enabled': True,
    },
    {
        'code': 'centurion',
        'name': '百积分达人',
        'category': 'milestone',
        'description': '累计确认积分达到 100',
        'icon': 'trophy',
        'auto_enabled': True,
    },
    {
        'code': 'veteran',
        'name': '资深贡献者',
        'category': 'milestone',
        'description': '累计完成 20 个任务',
        'icon': 'medal',
        'auto_enabled': True,
    },
    {
        'code': 'impact-maker',
        'name': '影响力贡献者',
        'category': 'task',
        'description': '对高价值任务产生显著贡献',
        'icon': 'spark',
        'auto_enabled': False,
    },
    {
        'code': 'efficiency-star',
        'name': '效率之星',
        'category': 'task',
        'description': '在效率优化任务中表现突出',
        'icon': 'star',
        'auto_enabled': False,
    },
    {
        'code': '效率之星',
        'name': '效率之星（兼容）',
        'category': 'task',
        'description': '兼容历史数据的徽章编码',
        'icon': 'star',
        'auto_enabled': False,
    },
]

BADGE_BY_CODE = {str(item['code']): item for item in BADGE_DEFINITIONS}


def list_badge_definitions() -> list[dict[str, object]]:
    return BADGE_DEFINITIONS


def is_valid_badge_code(code: str | None) -> bool:
    return bool(code and code in BADGE_BY_CODE)


def get_badge_definition(code: str) -> dict[str, object] | None:
    return BADGE_BY_CODE.get(code)


def grant_badge_if_missing(
    session: Session,
    user_id: int,
    badge_code: str,
    source_type: str,
    source_id: int | None,
) -> bool:
    if not is_valid_badge_code(badge_code):
        return False
    existing = session.exec(
        select(UserBadge).where(UserBadge.user_id == user_id, UserBadge.badge_code == badge_code)
    ).first()
    if existing is not None:
        return False
    session.add(
        UserBadge(
            user_id=user_id,
            badge_code=badge_code,
            source_type=source_type,
            source_id=source_id,
            earned_at=datetime.utcnow(),
        )
    )
    return True


def _confirmed_points(session: Session, user_id: int) -> int:
    result = session.exec(
        select(func.coalesce(func.sum(Reward.points), 0)).where(
            Reward.user_id == user_id,
            Reward.status == RewardStatus.CONFIRMED,
        )
    ).one()
    return int(result or 0)


def _approved_problem_count(session: Session, user_id: int) -> int:
    result = session.exec(
        select(func.count())
        .select_from(Problem)
        .where(
            Problem.submitter_id == user_id,
            Problem.status.in_([ProblemStatus.APPROVED, ProblemStatus.ARCHIVED]),
        )
    ).one()
    return int(result or 0)


def _completed_executor_task_count(session: Session, user_id: int) -> int:
    result = session.exec(
        select(func.count(func.distinct(Reward.task_id)))
        .select_from(Reward)
        .where(
            Reward.user_id == user_id,
            Reward.role_type == RewardRoleType.EXECUTOR,
            Reward.status == RewardStatus.CONFIRMED,
        )
    ).one()
    return int(result or 0)


def _team_completed_task_count(session: Session, user_id: int) -> int:
    result = session.exec(
        select(func.count(func.distinct(Reward.task_id)))
        .select_from(Reward)
        .join(ClaimMember, ClaimMember.user_id == Reward.user_id)
        .join(Claim, Claim.id == ClaimMember.claim_id)
        .where(
            Reward.user_id == user_id,
            Reward.role_type == RewardRoleType.EXECUTOR,
            Reward.status == RewardStatus.CONFIRMED,
            Claim.task_id == Reward.task_id,
            Claim.mode == ClaimMode.TEAM,
            Claim.status == ClaimStatus.COMPLETED,
        )
    ).one()
    return int(result or 0)


def _s_level_completed_task_count(session: Session, user_id: int) -> int:
    result = session.exec(
        select(func.count(func.distinct(Reward.task_id)))
        .select_from(Reward)
        .join(Task, Task.id == Reward.task_id)
        .where(
            Reward.user_id == user_id,
            Reward.role_type == RewardRoleType.EXECUTOR,
            Reward.status == RewardStatus.CONFIRMED,
            Task.level == TaskLevel.S,
        )
    ).one()
    return int(result or 0)


def _on_time_completed_task_count(session: Session, user_id: int) -> int:
    result = session.exec(
        select(func.count(func.distinct(Reward.task_id)))
        .select_from(Reward)
        .join(ClaimMember, ClaimMember.user_id == Reward.user_id)
        .join(Claim, Claim.id == ClaimMember.claim_id)
        .join(Task, Task.id == Claim.task_id)
        .join(Deliverable, Deliverable.claim_id == Claim.id)
        .where(
            Reward.user_id == user_id,
            Reward.role_type == RewardRoleType.EXECUTOR,
            Reward.status == RewardStatus.CONFIRMED,
            Claim.task_id == Reward.task_id,
            Claim.status == ClaimStatus.COMPLETED,
            func.date(Deliverable.submitted_at) <= Task.due_date,
        )
    ).one()
    return int(result or 0)


def grant_badges_for_confirmed_reward(session: Session, reward: Reward) -> list[str]:
    granted: list[str] = []

    if reward.badge and grant_badge_if_missing(
        session,
        user_id=reward.user_id,
        badge_code=reward.badge,
        source_type='task_reward',
        source_id=reward.task_id,
    ):
        granted.append(reward.badge)

    user_id = reward.user_id
    metric = {
        'first_blood': _completed_executor_task_count(session, user_id) >= 1,
        'centurion': _confirmed_points(session, user_id) >= 100,
        'veteran': _completed_executor_task_count(session, user_id) >= 20,
        'problem_hunter': _approved_problem_count(session, user_id) >= 10,
        'team_player': _team_completed_task_count(session, user_id) >= 5,
        'innovator': _s_level_completed_task_count(session, user_id) >= 1,
        'speed_runner': _on_time_completed_task_count(session, user_id) >= 3,
    }

    for badge_code, matched in metric.items():
        if not matched:
            continue
        if grant_badge_if_missing(
            session,
            user_id=user_id,
            badge_code=badge_code,
            source_type='auto_achievement',
            source_id=None,
        ):
            granted.append(badge_code)

    return granted


def list_user_badges(session: Session, user_id: int) -> list[dict[str, object]]:
    rows = session.exec(
        select(UserBadge)
        .where(UserBadge.user_id == user_id)
        .order_by(UserBadge.earned_at.desc())
    ).all()
    output: list[dict[str, object]] = []
    for row in rows:
        base = BADGE_BY_CODE.get(row.badge_code)
        if base is None:
            continue
        output.append(
            {
                'code': row.badge_code,
                'name': base['name'],
                'category': base['category'],
                'description': base['description'],
                'icon': base['icon'],
                'auto_enabled': base['auto_enabled'],
                'source_type': row.source_type,
                'source_id': row.source_id,
                'earned_at': row.earned_at,
            }
        )
    return output
