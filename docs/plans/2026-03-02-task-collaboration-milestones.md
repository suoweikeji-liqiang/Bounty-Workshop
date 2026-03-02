# Task Collaboration And Milestones Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a unified task activity timeline plus milestone-based staged execution for complex tasks without breaking the existing simple-task flow.

**Architecture:** Keep the current task, claim, deliverable, final acceptance, and reward pipeline as the source of truth for overall completion. Add a horizontal `TaskActivity` timeline for discussion and progress, and an optional `TaskMilestone` layer for complex tasks that earns held incentive portions before final release. Preserve backward compatibility by gating milestone behavior behind `Task.is_complex`.

**Tech Stack:** FastAPI, SQLModel, SQLite, pytest, React, TypeScript

---

### Task 1: Add failing backend coverage for activity timeline

**Files:**
- Modify: `tests/test_flow.py`

**Step 1: Write the failing test**

Add tests covering:
- task viewer can list empty activities
- non-claimant can add `comment`
- outsider cannot read timeline for inaccessible claim/task detail
- claim lead can add `progress_update`
- ordinary viewer cannot add `progress_update`

**Step 2: Run test to verify it fails**

Run: `pytest tests/test_flow.py -k "task_activity" -v`
Expected: FAIL because activity endpoints and models do not exist.

**Step 3: Write minimal implementation**

Create only the smallest backend pieces needed to make activity list/create authorization work.

**Step 4: Run test to verify it passes**

Run: `pytest tests/test_flow.py -k "task_activity" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/test_flow.py app
git commit -m "test: cover task activity timeline permissions"
```

### Task 2: Add activity schema, storage, and APIs

**Files:**
- Create: `migration_task_collaboration_v3.py`
- Modify: `app/models.py`
- Modify: `app/enums.py`
- Modify: `app/schemas.py`
- Create: `app/services_task_activity.py`
- Create: `app/routers/task_activities.py`
- Modify: `app/main.py`
- Modify: `app/services_claims.py`
- Modify: `app/services_tasks.py`

**Step 1: Add schema primitives**

Define:
- task complexity flag
- activity type enum
- activity read/create payloads

**Step 2: Add persistence**

Create migration and SQLModel tables for `TaskActivity`.

**Step 3: Add service layer**

Implement list/create/delete logic with permission checks and attachment binding reuse.

**Step 4: Add routing**

Expose:
- `GET /tasks/{task_id}/activities`
- `POST /tasks/{task_id}/activities`
- `DELETE /activities/{activity_id}`
- `GET /claims/{claim_id}/activities`

**Step 5: Mirror system events**

Write `system_event` records from existing claim, abandon, deliverable submit, deliverable accept, and overdue release flows.

**Step 6: Run targeted tests**

Run: `pytest tests/test_flow.py -k "task_activity or abandon_claim_flow or release_overdue_claims" -v`
Expected: PASS

**Step 7: Commit**

```bash
git add migration_task_collaboration_v3.py app/models.py app/enums.py app/schemas.py app/services_task_activity.py app/routers/task_activities.py app/main.py app/services_claims.py app/services_tasks.py tests/test_flow.py
git commit -m "feat: add task activity timeline backend"
```

### Task 3: Add failing backend coverage for milestone configuration and sequencing

**Files:**
- Modify: `tests/test_flow.py`

**Step 1: Write the failing test**

Add tests covering:
- reviewer can create a complex task with 2 milestones
- simple tasks reject milestone payloads
- milestone ratios must sum with closing ratio to 1
- only one milestone is active at a time

**Step 2: Run test to verify it fails**

Run: `pytest tests/test_flow.py -k "task_milestone_config" -v`
Expected: FAIL because milestone models and validation do not exist.

**Step 3: Write minimal implementation**

Add only enough backend validation and persistence for milestone creation and first milestone activation.

**Step 4: Run test to verify it passes**

Run: `pytest tests/test_flow.py -k "task_milestone_config" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/test_flow.py app
git commit -m "test: cover milestone task configuration"
```

### Task 4: Implement milestone models and task-definition integration

**Files:**
- Modify: `app/models.py`
- Modify: `app/enums.py`
- Modify: `app/schemas.py`
- Modify: `app/services_problems.py`
- Modify: `app/services_tasks.py`
- Modify: `app/routers/tasks.py`
- Modify: `tests/test_problem_workflow_v2.py`

**Step 1: Add milestone models**

Create:
- `TaskMilestone`
- `MilestoneSubmission`
- `MilestoneAcceptance`
- `MilestoneRewardHold`

**Step 2: Extend task definitions**

Allow review-time task payloads to mark `is_complex` and submit milestone definitions.

**Step 3: Validate milestone rules**

Enforce:
- complex-task gate
- 2-5 milestone limit
- sequential numbering
- required acceptance criteria
- reward ratio totals

**Step 4: Activate first milestone on claim**

When the first claim is created for a complex task, activate milestone 1 if no milestone is active yet.

**Step 5: Run targeted tests**

Run: `pytest tests/test_problem_workflow_v2.py tests/test_flow.py -k "milestone or reviewer_prices_but_does_not_define_task_content" -v`
Expected: PASS

**Step 6: Commit**

```bash
git add app/models.py app/enums.py app/schemas.py app/services_problems.py app/services_tasks.py app/routers/tasks.py tests/test_problem_workflow_v2.py tests/test_flow.py
git commit -m "feat: add complex task milestone definitions"
```

### Task 5: Add failing backend coverage for milestone submission and acceptance

**Files:**
- Modify: `tests/test_flow.py`

**Step 1: Write the failing test**

Add tests covering:
- claim lead submits milestone output
- accepter can mark milestone `rework`
- approved milestone activates the next milestone
- final milestone approval enables final task deliverable submission
- accepter cannot accept own milestone output

**Step 2: Run test to verify it fails**

Run: `pytest tests/test_flow.py -k "milestone_execution" -v`
Expected: FAIL because milestone submission and acceptance endpoints do not exist.

**Step 3: Write minimal implementation**

Implement only the current milestone submission and acceptance flow needed by the tests.

**Step 4: Run test to verify it passes**

Run: `pytest tests/test_flow.py -k "milestone_execution" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/test_flow.py app
git commit -m "test: cover milestone execution flow"
```

### Task 6: Implement milestone execution, pending acceptance queue, and held incentives

**Files:**
- Modify: `app/schemas.py`
- Modify: `app/services_claims.py`
- Create: `app/services_milestones.py`
- Create: `app/routers/milestones.py`
- Modify: `app/services_rewards.py`
- Modify: `app/main.py`

**Step 1: Add service primitives**

Implement milestone list, submit, accept, and per-user pending queue reads.

**Step 2: Add held incentive logic**

On milestone approval, calculate team member shares and create `MilestoneRewardHold(status="earned")`.

**Step 3: Add final release logic**

When final task acceptance succeeds:
- release milestone holds
- create closing reward records
- keep simple-task logic unchanged

**Step 4: Add failure handling**

Ensure rejected final task or cancelled milestone does not silently pay held incentives.

**Step 5: Add routing**

Expose:
- `GET /tasks/{task_id}/milestones`
- `POST /tasks/{task_id}/milestones`
- `PUT /milestones/{milestone_id}`
- `POST /milestones/{milestone_id}/submit`
- `POST /milestones/{milestone_id}/accept`
- `GET /milestones/pending-acceptance/mine`

**Step 6: Run targeted tests**

Run: `pytest tests/test_flow.py -k "milestone_execution or acceptor_cannot_accept_own_deliverable or flow_smoke" -v`
Expected: PASS

**Step 7: Commit**

```bash
git add app/schemas.py app/services_claims.py app/services_milestones.py app/routers/milestones.py app/services_rewards.py app/main.py tests/test_flow.py
git commit -m "feat: add milestone execution and held incentives"
```

### Task 7: Add frontend timeline UI

**Files:**
- Modify: `web/src/pages/TaskHallPage.tsx`
- Modify: `web/src/pages/ExecutionLoopPage.tsx`
- Create: `web/src/components/TaskActivityTimeline.tsx`
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/types.ts`

**Step 1: Add API client types**

Define activity payloads and timeline reads.

**Step 2: Render timeline**

Show one time-ordered timeline with filters for:
- comment
- progress update
- blocker
- official note
- system event

**Step 3: Add composer controls**

Allow valid users to post comments, progress updates, and blockers.

**Step 4: Verify manually**

Run: `cd web && npm run build`
Expected: build succeeds with no type errors.

**Step 5: Commit**

```bash
git add web/src/pages/TaskHallPage.tsx web/src/pages/ExecutionLoopPage.tsx web/src/components/TaskActivityTimeline.tsx web/src/lib/api.ts web/src/types.ts
git commit -m "feat: add task activity timeline ui"
```

### Task 8: Add frontend complex-task milestone UI

**Files:**
- Modify: `web/src/pages/ReviewWorkbenchPage.tsx`
- Modify: `web/src/pages/BudgetReviewPage.tsx`
- Modify: `web/src/pages/ExecutionLoopPage.tsx`
- Create: `web/src/components/MilestoneEditor.tsx`
- Create: `web/src/components/MilestoneAcceptancePanel.tsx`
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/types.ts`

**Step 1: Add task-definition controls**

Expose:
- complex-task toggle
- milestone editor
- reward ratio validation feedback

**Step 2: Add execution views**

Show current milestone, milestone submission form, milestone history, and pending milestone acceptance.

**Step 3: Preserve simple-task UX**

Hide milestone UI when `is_complex` is false.

**Step 4: Verify manually**

Run: `cd web && npm run build`
Expected: build succeeds and simple-task pages still render.

**Step 5: Commit**

```bash
git add web/src/pages/ReviewWorkbenchPage.tsx web/src/pages/BudgetReviewPage.tsx web/src/pages/ExecutionLoopPage.tsx web/src/components/MilestoneEditor.tsx web/src/components/MilestoneAcceptancePanel.tsx web/src/lib/api.ts web/src/types.ts
git commit -m "feat: add complex task milestone ui"
```

### Task 9: Add stale-progress reminder and notification hooks

**Files:**
- Modify: `app/jobs.py`
- Modify: `app/services_task_activity.py`
- Modify: `app/feishu.py`
- Modify: `app/services_common.py`
- Modify: `tests/test_flow.py`

**Step 1: Write the failing test**

Add test coverage for stale-progress reminder detection on active complex and simple tasks.

**Step 2: Run test to verify it fails**

Run: `pytest tests/test_flow.py -k "stale_progress" -v`
Expected: FAIL because no reminder job exists.

**Step 3: Write minimal implementation**

Detect tasks with no recent `progress_update` and emit reminder activity plus notification hook.

**Step 4: Run test to verify it passes**

Run: `pytest tests/test_flow.py -k "stale_progress" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add app/jobs.py app/services_task_activity.py app/feishu.py app/services_common.py tests/test_flow.py
git commit -m "feat: add stale progress reminders"
```

### Task 10: Final verification and documentation

**Files:**
- Modify: `README.md`
- Modify: `用户使用指南.md`

**Step 1: Update product docs**

Document:
- complex-task milestones
- unified activity timeline
- staged incentive release
- milestone acceptance queue

**Step 2: Run backend regression suite**

Run: `pytest tests/test_flow.py tests/test_problem_workflow_v2.py tests/test_attachments.py -q`
Expected: PASS

**Step 3: Run frontend verification**

Run: `cd web && npm run build`
Expected: PASS

**Step 4: Review git diff**

Run: `git diff --stat`
Expected: shows schema, backend, frontend, tests, and docs aligned with the feature scope.

**Step 5: Commit**

```bash
git add README.md 用户使用指南.md
git commit -m "docs: describe task collaboration and milestone workflow"
```
