# Incomplete Problem Review Submission Design

**Date:** 2026-02-28

**Problem**

Users can save a problem without a complete task draft and the backend may place it into `pending_review`. Reviewers then receive a review item with missing task definition content.

**Decision**

Problem creation and resubmission will always persist as `draft`. Transition to `pending_review` is only allowed through `/problems/{id}/submit-for-review`, where the backend already validates task goal, scope, due date, acceptance criteria, and submitter reflection.

**Scope**

- Fix backend state transitions in problem create/resubmit flows.
- Add regression tests for incomplete drafts and valid review submission.
- Add a frontend hint clarifying that incomplete content remains a draft until formal submission.

**Out of Scope**

- Changing reviewer detail rendering.
- Redesigning the problem form.
- Altering review or pricing workflows.

**Error Handling**

- Incomplete drafts remain savable as `draft`.
- Review submission continues returning `400` when required task draft fields are missing.

**Testing**

- Verify incomplete create stays `draft`.
- Verify incomplete resubmit stays `draft`.
- Verify submit-for-review rejects incomplete task draft.
- Verify complete task draft can still enter `pending_review`.
