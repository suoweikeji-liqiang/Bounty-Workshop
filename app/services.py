"""Re-export facade — keeps ``from app.services import X`` working."""
from __future__ import annotations

# common
from app.services_common import (  # noqa: F401
    _to_json,
    _from_json,
    _from_json_list,
    _from_json_dict,
    _decimal,
    _money_to_cents,
    _cents_to_amount,
    _log,
    _ensure_user_exists,
    _ensure_role,
    user_to_read,
    CLAIM_APPROVAL_OVERDUE_THRESHOLD_KEY,
    DEFAULT_CLAIM_APPROVAL_OVERDUE_THRESHOLD,
    MIN_CLAIM_APPROVAL_OVERDUE_THRESHOLD,
    MAX_ACTIVE_CLAIMS_PER_USER,
)

# users
from app.services_users import (  # noqa: F401
    create_user,
    list_users,
    get_user_detail,
    list_active_users,
    list_acceptor_candidates,
    get_my_profile,
    get_my_summary,
    set_user_roles,
    set_user_status,
)

# tasks
from app.services_tasks import (  # noqa: F401
    list_tasks,
    get_task_detail,
)

# problems
from app.services_problems import (  # noqa: F401
    create_problem,
    get_problem_detail,
    resubmit_problem,
    list_problems,
    review_problem,
    trigger_problem_analysis,
    get_problem_analysis,
    list_hypothesis_verifications,
    update_hypothesis_verification,
    create_analysis_ref,
)

# claims
from app.services_claims import (  # noqa: F401
    get_claim_approval_overdue_threshold,
    set_claim_approval_overdue_threshold,
    list_my_claims,
    list_my_pending_acceptance,
    get_claim_execution_detail,
    list_claim_approval_requests,
    approve_claim_approval_request,
    reject_claim_approval_request,
    claim_task,
    abandon_claim,
    submit_deliverable,
    accept_deliverable,
    release_overdue_claims,
)

# rewards & knowledge
from app.services_rewards import (  # noqa: F401
    list_rewards,
    confirm_reward,
    list_knowledge,
    get_knowledge_detail,
)

# dashboard & logs
from app.services_dashboard import (  # noqa: F401
    dashboard_overview,
    list_operation_logs,
)
