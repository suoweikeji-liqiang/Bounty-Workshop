from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import func
from sqlmodel import Session, select

from app.enums import ClaimStatus, ProblemStatus, RewardStatus, TaskStatus
from app.models import Claim, OperationLog, Problem, Reward, Task, User
from app.schemas import DashboardOverview, OperationLogRead
from app.services_common import _from_json_dict


def dashboard_overview(session: Session) -> DashboardOverview:
    problem_total = session.exec(select(func.count()).select_from(Problem)).one()
    problem_approved = session.exec(
        select(func.count()).select_from(Problem).where(Problem.status == ProblemStatus.APPROVED)
    ).one()
    task_total = session.exec(select(func.count()).select_from(Task)).one()
    task_completed = session.exec(
        select(func.count()).select_from(Task).where(Task.status == TaskStatus.COMPLETED)
    ).one()
    task_overdue_claims = session.exec(
        select(func.count()).select_from(Claim).where(Claim.status == ClaimStatus.OVERDUE)
    ).one()
    reward_total_confirmed_amount = session.exec(
        select(func.coalesce(func.sum(Reward.amount), 0.0)).where(Reward.status == RewardStatus.CONFIRMED)
    ).one()
    completion_rate = (int(task_completed) / int(task_total)) if int(task_total) > 0 else 0.0
    overdue_rate = (int(task_overdue_claims) / int(task_total)) if int(task_total) > 0 else 0.0

    return DashboardOverview(
        problem_total=int(problem_total),
        problem_approved=int(problem_approved),
        task_total=int(task_total),
        task_completed=int(task_completed),
        task_overdue_claims=int(task_overdue_claims),
        task_completion_rate=round(completion_rate, 4),
        task_overdue_rate=round(overdue_rate, 4),
        reward_total_confirmed_amount=float(reward_total_confirmed_amount or 0.0),
    )


def list_operation_logs(
    session: Session,
    action: str | None = None,
    actor_user_id: int | None = None,
    created_from: date | None = None,
    created_to: date | None = None,
    limit: int = 200,
) -> list[OperationLogRead]:
    statement = select(OperationLog)
    if action:
        statement = statement.where(OperationLog.action == action)
    if actor_user_id is not None:
        statement = statement.where(OperationLog.actor_user_id == actor_user_id)
    if created_from is not None:
        statement = statement.where(
            OperationLog.created_at >= datetime.combine(created_from, datetime.min.time())
        )
    if created_to is not None:
        statement = statement.where(
            OperationLog.created_at < datetime.combine(created_to + timedelta(days=1), datetime.min.time())
        )

    rows = session.exec(statement.order_by(OperationLog.created_at.desc()).limit(max(1, min(limit, 1000)))).all()
    actor_ids = {int(row.actor_user_id) for row in rows if row.actor_user_id is not None}
    actor_name_map: dict[int, str] = {}
    if actor_ids:
        actor_rows = session.exec(select(User.id, User.name).where(User.id.in_(actor_ids))).all()
        actor_name_map = {int(user_id): user_name for user_id, user_name in actor_rows}
    output: list[OperationLogRead] = []
    for row in rows:
        detail = _from_json_dict(row.detail)
        output.append(
            OperationLogRead(
                id=row.id,
                actor_user_id=row.actor_user_id,
                actor_user_name=actor_name_map.get(int(row.actor_user_id)) if row.actor_user_id is not None else None,
                action=row.action,
                target_type=row.target_type,
                target_id=row.target_id,
                detail=detail,
                created_at=row.created_at,
            )
        )
    return output
