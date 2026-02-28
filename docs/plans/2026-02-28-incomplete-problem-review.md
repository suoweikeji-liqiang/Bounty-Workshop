# Incomplete Problem Review Submission Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent incomplete problem task drafts from entering reviewer queues while still allowing users to save partial drafts.

**Architecture:** Keep the workflow boundary in the backend state machine. Problem create/resubmit only save draft data. `submit-for-review` remains the single gate into reviewer-visible state and enforces completeness checks. Add a small frontend hint so the workflow is obvious to users.

**Tech Stack:** FastAPI, SQLModel, pytest, React, TypeScript

---

### Task 1: Add failing regression coverage

**Files:**
- Modify: `tests/test_flow.py`

**Step 1: Write the failing test**

Add tests covering:
- incomplete create returns `draft`
- incomplete resubmit returns `draft`
- incomplete submit-for-review returns `400`
- complete submit-for-review returns `pending_review`

**Step 2: Run test to verify it fails**

Run: `pytest tests/test_flow.py -k "incomplete_problem_draft" -v`
Expected: at least one failure showing the current backend marks incomplete submissions as `pending_review`.

**Step 3: Write minimal implementation**

Update backend status assignment so create/resubmit stay in `draft`.

**Step 4: Run test to verify it passes**

Run: `pytest tests/test_flow.py -k "incomplete_problem_draft" -v`
Expected: PASS

### Task 2: Fix backend workflow

**Files:**
- Modify: `app/services_problems.py`

**Step 1: Keep create in draft**

Set initial problem status to `draft`.

**Step 2: Keep resubmit in draft**

Set resubmitted problems back to `draft` regardless of task draft completeness.

**Step 3: Preserve formal submission gate**

Leave `submit_problem_for_review` completeness checks in place.

**Step 4: Run targeted tests**

Run: `pytest tests/test_flow.py -k "incomplete_problem_draft or pricing_review_requires_completed_analysis" -v`
Expected: PASS

### Task 3: Clarify frontend behavior

**Files:**
- Modify: `web/src/pages/ProblemsPage.tsx`

**Step 1: Add a concise hint**

Explain that saving only stores a draft and reviewer submission requires complete task definition.

**Step 2: Verify behavior manually by inspection**

Confirm the hint appears near the composer without changing submit behavior.

### Task 4: Final verification

**Files:**
- Modify: none

**Step 1: Run focused backend regression suite**

Run: `pytest tests/test_flow.py -k "incomplete_problem_draft or submitter_cannot_review_own_problem or pricing_review_requires_completed_analysis" -v`
Expected: PASS
