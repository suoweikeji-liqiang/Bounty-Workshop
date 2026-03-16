# Task Type, Budget Approval, And Mountain Tasks Design

**Date:** 2026-03-16

**Problem**

The current project flow has two gaps against the new requirements:

- Budget review is threshold-based, so lower-budget projects can still be approved and converted into tasks without finance approval.
- Task modeling only distinguishes between normal tasks and complex tasks through `is_complex`, which is not enough to express a new strategic "mountain task" class with stronger constraints.

The new requirements are:

- Every project fund decision must go through finance approval.
- Add a new mountain task class with reward `>= 100000`, long execution cycle, at least `3` milestones, and company-changing impact.

**Decision**

Replace the current implicit task-shape model with an explicit task type model and make finance approval mandatory for all approved pricing decisions.

- Add `task_type` with `normal | complex | mountain`.
- Keep milestone execution as the shared staged-delivery mechanism for both `complex` and `mountain`.
- Route every approved review result into `budget_pending` before a task can be created.
- Treat mountain tasks as a first-class business type instead of overloading `is_complex`.

**Goals**

- Make finance approval mandatory for every approved project pricing decision.
- Model mountain tasks explicitly so they can carry distinct validation, reporting, and workflow rules.
- Preserve the existing milestone execution flow for complex tasks while extending it to mountain tasks.
- Keep existing data readable and compatible during rollout.

**Non-Goals**

- No new approval role beyond the existing finance/reward approver role.
- No separate mountain-task execution engine; the existing milestone engine remains the base.
- No automatic reclassification of old complex tasks into mountain tasks.
- No attempt in v1 to encode "company-changing impact" as a measurable score; that remains a reviewer/business judgment.

**Architecture**

Task definition and pricing remain a two-stage flow:

1. Reviewer prices and defines the task shape.
2. Finance approves or rejects the priced result.
3. Only finance approval creates the real `Task`.

The core structural change is replacing `is_complex` as the source of truth with `task_type`. Internally, milestone-enabled behavior becomes `task_type in {"complex", "mountain"}`. Existing reads stay backward compatible by continuing to expose `is_complex` for one transition period.

This keeps the current problem -> review -> budget review -> task creation pipeline intact while making the task model expressive enough for long-cycle strategic work.

**Data Model**

1. Add explicit task type

- `TaskType` enum with:
  - `normal`
  - `complex`
  - `mountain`

2. Extend priced problem state

- Add `Problem.priced_task_type`
- Keep:
  - `priced_is_complex`
  - `priced_closing_reward_ratio`
  - `priced_milestones_json`
- During the transition period:
  - `priced_task_type = normal` maps to `priced_is_complex = false`
  - `priced_task_type in {complex, mountain}` maps to `priced_is_complex = true`

3. Extend task state

- Add `Task.task_type`
- Keep `Task.is_complex` for compatibility in reads and old logic bridges
- During the transition period:
  - `task_type = normal` maps to `is_complex = false`
  - `task_type in {complex, mountain}` maps to `is_complex = true`

4. Extend request and response schemas

- `TaskDefinition.task_type`
- task/problem read payloads return `task_type`
- keep `is_complex` in responses for one release to avoid breaking existing UI paths

**Workflow**

1. Reviewer approval

- Reviewer can still reject or request changes as today.
- If reviewer approves pricing or task definition:
  - save priced fields on `Problem`
  - set `Problem.status = budget_pending`
  - do not create a `Task` yet

2. Finance approval

- Finance approver reviews the priced problem.
- If approved:
  - create `Task`
  - persist `task_type`
  - persist milestone definitions if required
  - set `Problem.status = approved`
- If rejected:
  - set `Problem.status = pricing_revision_required`
  - keep the priced payload for rework

3. Re-review after finance rejection

- Reviewer can change reward, task type, milestone setup, and due date.
- Re-approval by reviewer still goes back to `budget_pending`.
- No pricing path bypasses finance review.

**Validation Rules**

1. Common rule

- Any reviewer approval that includes valid pricing or task definition must transition to `budget_pending`.
- `budget_review_threshold` no longer controls routing logic.

2. `normal`

- no milestones allowed
- `closing_reward_ratio = 1`

3. `complex`

- requires `2-5` milestones
- uses the existing milestone execution flow
- milestone reward ratios plus closing reward ratio must equal `1`
- reward level ranges continue to use current level-based limits

4. `mountain`

- requires `task_type = mountain`
- requires `level = S`
- requires `reward_total >= 100000`
- requires at least `3` milestones
- requires due date at least `180` days after the approval date used to create the real task
- requires milestone reward ratios plus closing reward ratio to equal `1`
- always uses milestone execution flow

5. Reclassification guard

- If a finance-rejected mountain task is repriced below `100000`, reviewer must change it away from `mountain`.
- Old complex tasks are not auto-promoted to `mountain`.

**UI Changes**

1. Review workbench

- Replace the existing complex-task checkbox with a task-type selector:
  - normal
  - complex
  - mountain
- `normal` hides the milestone editor and fixes closing ratio to `1`
- `complex` shows milestone editor and enforces `2-5` milestones
- `mountain` shows milestone editor and adds visible guidance for:
  - reward `>= 100000`
  - due date `>= 180` days out
  - at least `3` milestones

2. Budget review page

- Show the new task type label instead of the old normal/complex split
- Show mountain-task-specific summary fields clearly

3. Task detail and task hall

- Display `normal`, `complex`, or `mountain`
- Preserve old `is_complex` fallback in UI reads until all APIs are updated

4. System config

- Remove or mark the budget threshold setting as deprecated/disabled
- Avoid suggesting that finance approval can still be switched by amount

**Compatibility And Migration**

1. Database migration

- add `priced_task_type` to `Problem`
- add `task_type` to `Task`
- backfill:
  - `priced_is_complex = false` -> `priced_task_type = normal`
  - `priced_is_complex = true` -> `priced_task_type = complex`
  - `is_complex = false` -> `task_type = normal`
  - `is_complex = true` -> `task_type = complex`

2. Read compatibility

- API responses return both:
  - `task_type`
  - `is_complex`
- UI reads `task_type` first and falls back to `is_complex` when needed

3. Execution compatibility

- milestone routes and storage stay unchanged
- milestone gating changes from `is_complex` to `task_type in {"complex", "mountain"}`

**Testing**

Backend coverage must add at least:

- reviewer approval with low reward still returns `budget_pending`
- finance approval creates the task for a low-reward normal task
- mountain task below `100000` is rejected
- mountain task with fewer than `3` milestones is rejected
- mountain task with due date under `180` days is rejected
- repriced rejected mountain task must change type if reward falls below `100000`
- legacy rows with only `is_complex` semantics still read correctly as `task_type = complex`

Frontend verification must cover:

- task type selector behavior in review workbench
- milestone editor visibility by task type
- mountain-task validation messages
- task type labels in task hall, task detail, and budget review
- budget threshold config no longer behaves like an active routing control

**Risks**

- Keeping both `task_type` and `is_complex` temporarily can drift if not written consistently.
- Finance approval logic now affects every review path, so low-reward flows can regress if tests are incomplete.
- Mountain-task due-date validation can become ambiguous if the rule is tied to review date instead of final approval date.

**Mitigations**

- Centralize the compatibility mapping in service/schema helpers.
- Add targeted regression tests for both low-reward and high-reward approval paths.
- Apply the `180`-day rule at final task creation time so the validation matches actual finance approval timing.

**Rollout**

Implement in this order:

1. Add failing backend tests for mandatory finance approval and task type reads.
2. Add enum, schema, migration, and service-layer compatibility mapping.
3. Add mountain-task validation and milestone gating updates.
4. Update frontend task-type editing and display.
5. Remove/deprecate budget-threshold UX.
6. Update docs and regression coverage.
