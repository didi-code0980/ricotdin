# Reliability Module (REL)

**Module prefix:** REL  
**Status:** ❌ Not started — all three features are production blockers  
**Priority:** Blocker — must be resolved before serving real users

---

## Overview

The Reliability module addresses the fire-and-forget nature of the current processing pipeline. Today, jobs run in-process with the Next.js server; a server restart drops any in-flight job permanently. This module replaces that with a durable queue/worker, adds stuck-job recovery, and ensures retries are idempotent. These are the highest-priority production blockers.

---

## Features

### REL-01 — Durable job queue / worker
**Status:** ❌ Not started  
**Blocker:** Yes — top production priority

**User Story**  
As the system, I want processing jobs to run on a durable queue/worker so jobs aren't lost on server restart.

**Use Cases**
1. User uploads a meeting; instead of `processMeeting()` being called fire-and-forget in the HTTP response handler, a job is enqueued.
2. Server restarts; the job is still in the queue and will be picked up when the worker comes back.
3. Worker picks up the job and runs `processMeeting()`.
4. If the worker crashes mid-job, the job is visible as stuck (REL-02 handles recovery).
5. Job outcomes (success/failure) are written back to `meetings.status`.

**Current state:**  
`processMeeting()` is called without `await` in `POST /api/meetings/:id/uploaded`. If the Next.js process restarts, the job is lost and the meeting stays in `pending` state forever.

**Frontend**
- No UI change required; status polling already works.
- Failure/stuck detection via ADM-04 pipeline monitor.

**Backend options:**
- **Option A (recommended for self-hosted):** Inngest or Trigger.dev — managed durable queue, works with Next.js.
- **Option B (no external deps):** A `job_queue` Postgres table + polling worker (cron or long-poll). Simpler but requires periodic DB queries.
- **Implementation steps:**
  1. Replace direct `processMeeting()` call with `enqueueJob(meetingId)`.
  2. Worker picks up `pending` jobs, processes them, updates status.
  3. Worker uses a lease/lock mechanism to prevent double-processing.

---

### REL-02 — Stuck-job recovery
**Status:** ❌ Not started  
**Blocker:** Yes

**User Story**  
As the system, I want to scan meetings stuck in processing too long and auto-requeue them so no meeting is stuck forever.

**Use Cases**
1. A meeting has `status = 'processing'` and `updated_at < now() - 15 minutes` (the "stuck" threshold).
2. A background cron (every 5 minutes) detects stuck meetings.
3. Stuck meetings are automatically requeued: status reset to `pending`, child rows cleared, job re-enqueued.
4. Admin pipeline monitor (ADM-04) shows stuck meetings; admin can also manually requeue.
5. If a meeting gets stuck repeatedly (e.g., 3+ times), it is marked `failed` with an error explaining it exceeded retry limits.

**Frontend**
- Stuck meetings surface as the "Stuck" tile in the ADM-04 pipeline monitor.
- Auto-recovery is transparent to the user; the meeting progresses without manual intervention.

**Backend**
- Cron worker queries: `meetings WHERE status='processing' AND updated_at < now() - interval '15 minutes'`.
- Requeue logic: same as `POST /api/admin/pipeline/:id/requeue` (already built in ADM-04).
- Retry counter: `meetings.requeue_count` column — increment on each auto-requeue, fail after threshold.
- Depends on: REL-01 (durable queue).

---

### REL-03 — Idempotent retries
**Status:** ❌ Not started  
**Blocker:** Yes

**User Story**  
As the system, I want retries to be idempotent so re-running doesn't create duplicate data.

**Use Cases**
1. A meeting is requeued (manually or automatically).
2. Before processing starts, the pipeline clears any existing output: `transcript_segments`, `todos`, `calendar_suggestions` (transcript_chunks cascade via FK).
3. Processing runs from scratch; no duplicate rows are created.
4. If the pipeline is interrupted mid-run and retried, starting over from scratch is safe.
5. The `meetings.status` transition is atomic: from `pending` to `processing` uses a row-level lock or conditional update to prevent two workers from processing the same meeting.

**Current state:**  
The manual requeue in `POST /api/admin/pipeline/:id/requeue` (ADM-04) already implements the cleanup step. This feature formalizes it as a standard pipeline entry-point invariant so all code paths (not just admin requeue) guarantee idempotency.

**Frontend**
- Transparent; the user sees at most one consistent set of results.

**Backend**
- Pipeline entry: before writing any new data, always delete existing output rows for the `meeting_id`.
- Atomic status transition: `UPDATE meetings SET status='processing' WHERE id=:id AND status='pending'` — zero rows updated means another worker got there first.
- Depends on: REL-01 (worker must acquire job atomically).

---

## Implementation Recommendation

Build in this order:
1. **REL-03 first** — make the existing pipeline idempotent (the cleanup is already in ADM-04 requeue, just needs to be applied universally). Low effort.
2. **REL-01 second** — add a durable queue. Evaluate Inngest (managed) vs. a DB-backed job table (simpler ops).
3. **REL-02 third** — add the cron-based stuck-job scanner. Trivial once REL-01 provides the requeue primitive.

## Dependencies

- **REL-01 depends on:** PRP-07 (pipeline status model)
- **REL-02 depends on:** REL-01
- **REL-03 depends on:** PRP-01 (meetings table), REL-01 (atomic job pickup)
- **ADM-04 depends on:** REL-01 (noted in tracking; currently partial — ADM-04 UI is done but the underlying queue isn't durable)
