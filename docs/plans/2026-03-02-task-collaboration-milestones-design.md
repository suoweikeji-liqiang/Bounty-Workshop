# Task Collaboration And Milestones Design

**Date:** 2026-03-02

**Problem**

Current task execution is still modeled as a single straight-line flow: claim, submit one deliverable, final acceptance, reward confirmation. That leaves three gaps:

- Complex tasks cannot define interim boundaries for staged acceptance and incentive.
- Non-claimants cannot contribute useful ideas through lightweight discussion.
- Execution progress is not first-class, so teams cannot see momentum, blockers, or stale work.

**Decision**

Introduce a unified collaboration layer for task execution and add milestone support only for explicitly complex tasks.

- Add `TaskActivity` as the shared timeline model for comments, progress updates, blocker reports, official notes, and system events.
- Add `TaskMilestone` and `MilestoneAcceptance` for staged execution, staged acceptance, and staged incentive accounting.
- Keep the existing task, claim, deliverable, final acceptance, and reward flow as the primary completion path.
- Gate milestone support behind `Task.is_complex`, so simple tasks remain unchanged.

**Goals**

- Let any visible task accumulate useful discussion without turning the system into a forum.
- Let claim owners and reviewers record execution progress and blockers in a structured timeline.
- Let complex tasks split delivery into 2-5 milestones with clear acceptance rules and staged incentive accounting.
- Preserve backward compatibility for existing simple-task workflows.

**Non-Goals**

- No general sub-task tree or project management suite.
- No threaded discussion, likes, reactions, or contribution points for comments.
- No standalone notification center in the first release.
- No mandatory milestone usage for all tasks.

**Architecture**

The new design keeps one top-level task record and one final task completion flow. Milestones are an optional middle layer for complex tasks only. Activities are a horizontal layer attached to tasks and optionally scoped to a claim or milestone.

This gives one consistent timeline in the UI and avoids creating separate systems for comments, progress tracking, and audit-style events. System-generated execution events are copied into the same timeline so users can read the whole story in one place.

**Data Model**

1. Extend `Task`

- Add `is_complex: bool = False`
- Add `progress_stale_after_days: int | None` or use a system config key for stale-progress reminders
- Keep current task status unchanged

2. Add `TaskMilestone`

- `id`
- `task_id`
- `sequence`
- `title`
- `goal`
- `due_date`
- `acceptance_criteria_json`
- `reward_ratio`
- `status` in `pending | active | pending_acceptance | approved | rework | cancelled`
- `created_at`
- `updated_at`

3. Add `MilestoneSubmission`

- `id`
- `milestone_id`
- `claim_id`
- `summary`
- `evidence_urls`
- `criteria_results_json`
- `submitted_by_user_id`
- `submitted_at`

4. Add `MilestoneAcceptance`

- `id`
- `milestone_id`
- `submission_id`
- `accepter_id`
- `result` in `approved | rework | cancelled`
- `comment`
- `created_at`

5. Add `TaskActivity`

- `id`
- `task_id`
- `claim_id` nullable
- `milestone_id` nullable
- `activity_type` in `comment | progress_update | blocker | official_note | system_event`
- `actor_user_id`
- `content`
- `detail_json`
- `attachment_urls`
- `visibility` with first release defaulting to task-visible
- `created_at`

6. Add staged incentive accounting

Prefer a dedicated table instead of overloading final `Reward` rows too early:

- `MilestoneRewardHold`
- `id`
- `task_id`
- `milestone_id`
- `claim_id`
- `user_id`
- `ratio`
- `amount`
- `status` in `earned | released | cancelled`
- `created_at`
- `released_at`

**Workflow**

1. Simple task

- Existing flow remains unchanged.
- Activity timeline still exists and records comments, progress updates, blockers, and system events.
- Final deliverable and final acceptance still generate final rewards as today.

2. Complex task with milestones

- Reviewer or budget reviewer configures `2-5` milestones when defining the task.
- After claim creation, the first milestone becomes `active`.
- Only one milestone can be `active` or `pending_acceptance` at a time.
- Claim owner submits milestone output for the current milestone.
- Accepter approves, requests rework, or cancels that milestone.
- Approved milestone creates `MilestoneRewardHold` rows and activates the next milestone.
- Final milestone approval unlocks final task deliverable submission.
- Final task acceptance converts milestone holds plus closing incentive into normal reward confirmation flow.

**Incentive Rules**

Use staged earning plus final release.

- Each complex task defines milestone reward ratios whose total plus the final closing ratio equals 100%.
- Recommended default: milestones cover 50%-70%, final closing incentive keeps 30%-50%.
- Milestone approval creates `earned` hold records, not directly confirmed rewards.
- Final task acceptance releases earned milestone holds and generates the closing reward portion.
- If the task fails after some milestones were approved, holds go into reviewer/admin decision instead of automatic payout.

This keeps the feedback benefit of staged progress without encouraging partial completion followed by abandonment.

**Permissions**

1. Activity visibility

- Anyone who can view the task can view its full timeline.

2. Activity creation

- `comment`: any logged-in user who can view the task
- `progress_update` and `blocker`: claim lead, claim members, reviewer, admin
- `official_note`: reviewer, admin
- `system_event`: system only

3. Activity deletion

- Author can delete own non-system activity
- Admin can delete any non-system activity
- `system_event` cannot be deleted

4. Milestone actions

- Milestone config: reviewer, admin, and budget reviewer where budget review already governs task creation
- Milestone submission: claim lead, or lead only for team claims to match current deliverable ownership
- Milestone acceptance: task accepter only, with same self-accept guard as final acceptance

**Notifications**

Keep notifications event-driven and minimal:

- New comment: notify claim lead
- New blocker: notify accepter and reviewer/admin
- Milestone pending acceptance: notify accepter
- Milestone rework: notify claim lead
- Final acceptance result or reward state change: notify affected users
- Stale progress reminder: notify claim lead and reviewer/admin

First release can surface these through page-level alerts plus optional Feishu hooks rather than a full in-app notification center.

**UI Changes**

1. Task detail and execution detail

- Add one unified timeline with type filters
- Allow posting comments, progress updates, and blockers
- Highlight official notes and system events

2. Review workbench and budget review

- Add a complex-task toggle
- Add milestone editor with title, goal, due date, acceptance criteria, and reward ratio

3. Acceptance views

- Add milestone pending-acceptance queue before final task acceptance
- Preserve final acceptance page for overall task completion

**Operational Rules**

- Milestones are sequential only in v1.
- Complex tasks are opt-in.
- Milestone count is limited to 2-5.
- Every milestone must have verifiable acceptance criteria and a non-zero reward ratio.
- Timeline should support attachment binding using the existing attachment model.

**Risks**

- Reward logic becomes more complex if milestone holds and final rewards are mixed carelessly.
- UI can become noisy if timeline types are not visually distinct.
- Reviewers may overuse milestones for simple tasks unless the complex-task gate is explicit.

**Mitigations**

- Keep final `Reward` semantics intact and isolate staged earning into `MilestoneRewardHold`.
- Add strong validation around milestone count, order, and ratio totals.
- Preserve current simple-task path with `is_complex = false`.

**Testing**

- Backward compatibility for simple-task flow
- Activity creation and visibility permissions
- Claim timeline reads for owner, accepter, reviewer, and outsider
- Milestone ordering and state transitions
- Rework loop on milestones
- Stale progress detection
- Milestone hold creation and final release behavior
- Complex-task final acceptance with staged incentives

**Rollout**

Ship all capability in one release branch, but implement in this internal order:

1. Schema and migration
2. Activity API and timeline UI
3. Milestone configuration and milestone execution
4. Staged incentive holds and release rules
5. Reminder and notification hooks
6. Docs and regression coverage
