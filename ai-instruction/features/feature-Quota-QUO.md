# Quota Module (QUO)

**Module prefix:** QUO  
**Status:** ❌ Not started — planning artifact only; no application code or migrations yet  
**Priority:** Important once usage cost matters; prepaid (admin-grant) for internal use, a stepping stone toward COM-03 (SaaS billing)

---

## Overview

The Quota module adds **enforcement** on top of the already-shipped usage telemetry (ADM-05 and the `usage_log` ledger). Telemetry *measures* what was spent; QUO *limits* what may be spent.

Each user has a **prepaid balance** that is topped up (by admin grant for now) and drawn down by billable AI actions. The model is deliberately simple:

- **No monthly limit and no period reset.** Balances persist until consumed or topped up again.
- **Actor pays.** The person who triggers a billable action is charged — not the meeting/folder owner.
- **Two separate balances**, because the two costly actions are metered in incommensurable units:
  - **Generate meeting** → draws down the **audio-minute** balance (stored as seconds, displayed as minutes).
  - **Ask agent (RAG)** → draws down the **agent-query** balance (one unit per question).
- **Viewing already-generated content** (transcript / summary / note / audio playback) → **never** consumes quota, because it incurs no marginal AI cost. This holds even for meetings shared from another user.

QUO is **enforcement only**. It depends on, and does not replace, the OBS/usage measurement layer (ADM-05 + `usage_log` + `lib/usage/logUsage.ts`).

> **Naming note:** the source brief referred to a `usage_events` ledger; in this codebase that telemetry table is **`usage_log`** (`migrations/009_usage_log.sql`), surfaced by the **ADM-05** AI-usage dashboard at `/admin/usage`.

---

## Features

### QUO-01 — Quota schema & balances
**Status:** ❌ Not started

**User Story**  
As the product owner, I want a per-user prepaid balance (audio-minutes + agent-queries) backed by an append-only ledger so usage is enforceable without a monthly reset.

**Use Cases**
1. A new user starts with a default grant (from `quota_policies`); their `quota_wallets` row reflects `audio_seconds_remaining` and `agent_queries_remaining`.
2. Any billable action reads the wallet for an O(1) balance check, then writes a movement to `quota_ledger` and updates the wallet atomically.
3. The wallet is a cache; the ledger is the source of truth and the wallet is fully derivable from it (sum of movements).
4. Balances never reset on a calendar boundary — they only change via top-up (`+`) or deduction (`−`).

**Frontend**
- No dedicated UI in this feature; balances are surfaced by QUO-05.

**Backend** *(describe only — do not implement here)*
- `quota_wallets` — cached current balance per user: `user_id`, `audio_seconds_remaining`, `agent_queries_remaining`, `updated_at`.
- `quota_ledger` — append-only financial ledger of balance movements: `id`, `user_id`, `kind` (`topup` | `generate` | `agent`), `axis` (`audio_seconds` | `agent_queries`), `amount` (signed), `dedup_key`, `meeting_id?`, `created_at`, `created_by?`.
- Atomic balance-update helper: a single DB-side function/transaction that appends a ledger row and adjusts the wallet together, so a wallet can never drift from its ledger.
- Builds on, and never modifies, the existing `usage_log` telemetry.

---

### QUO-02 — Generate enforcement
**Status:** ❌ Not started

**User Story**  
As the system, I want to gate meeting generation on the user's audio-minute balance before spending, then deduct the real billed duration after success.

**Use Cases**
1. A user triggers generation (record-and-process or upload-and-process).
2. **Pre-flight gate:** the ffprobe duration already available from REC-05 is compared against `audio_seconds_remaining` **before** calling Speechmatics. If the balance is insufficient, the job is rejected up front so **no spend occurs** on a rejected job.
3. After Speechmatics returns, the **real billed duration** is deducted (not the estimate) via a `quota_ledger` `generate` movement.
4. The charge is attributed to the user who triggered generation.
5. Viewing the resulting transcript/summary/note later costs nothing.

**Frontend**
- A clear "not enough minutes" message at the point of triggering generation, with the user's remaining balance (see QUO-05) and a hint to request a top-up.
- The upload/record flow blocks submission when the pre-flight gate would fail.

**Backend** *(describe only)*
- Pre-flight check in the generation entry path, reusing REC-05's ffprobe duration; reject with a quota error before any Speechmatics call.
- Post-success deduction of the actual billed duration, written in the same transaction as the usage record (see QUO-04).
- Depends on: QUO-01 (balance + ledger), REC-05 (ffprobe duration).

---

### QUO-03 — Ask-agent enforcement
**Status:** ❌ Not started

**User Story**  
As the system, I want to check the asker's agent-query balance before the RAG call and deduct on success so agent usage is billed to whoever asks.

**Use Cases**
1. A user asks the agent a question (single-meeting or cross-meeting RAG).
2. **Pre-check:** `agent_queries_remaining` is verified before the RAG retrieval/answer call.
3. On a successful answer, one agent-query unit is deducted via a `quota_ledger` `agent` movement.
4. **Shared folders (COM-05):** any role with folder access (viewer, editor, owner) may use the agent until **their own** balance runs out; the cost is charged to the asker, not the folder owner.
5. A shared user who is out of agent balance can **still view** the meeting — only the ask-agent action is blocked.

**Frontend**
- Chat composer shows remaining agent-queries (see QUO-05) and disables sending with an "out of agent queries" message when the balance is zero.
- The block is specific to asking — transcript/summary/note remain fully viewable.

**Backend** *(describe only)*
- Pre-check before the RAG call; deduct on success.
- Charge resolves to the authenticated asker regardless of folder role; the deduction is independent of meeting ownership.
- Depends on: QUO-01, RAG-01 (Q&A), COM-05 (folder share roles).

---

### QUO-04 — Idempotent deduction on retry/restart
**Status:** ❌ Not started

**User Story**  
As the system, I want quota deductions to be idempotent on retry/restart so a re-run never double-charges.

**Use Cases**
1. A generation job is retried after a transient failure or a server restart (the REL-01/REL-03 reliability concern).
2. Each `quota_ledger` deduction carries a **dedup key** derived from the work unit — e.g. `(meeting/job id + step + attempt)` — so a replay of the same step cannot insert a second deduction.
3. The deduction row is written in the **same transaction** as the usage record it corresponds to, so telemetry and quota can never disagree, and a half-applied charge is impossible.
4. **Re-generation of summary/note** (the isolated re-gen path that does **not** re-transcribe) consumes **0** audio-minute balance; token spend is still logged to telemetry (`usage_log`) but does not draw down quota.

**Frontend**
- None (correctness guarantee, not a UI feature).

**Backend** *(describe only)*
- Unique constraint on the ledger dedup key; insert is a no-op (or returns the prior row) on replay.
- Same-transaction write of the deduction + usage record.
- Re-gen path explicitly skips the audio-minute deduction.
- Depends on: QUO-01; aligns with REL-03 (idempotent retries) / NFR-1.

---

### QUO-05 — Top-up & balance display
**Status:** ❌ Not started

**User Story**  
As an admin, I want to grant/top-up a user's balance; as a user, I want to see my remaining minutes and queries.

**Use Cases**
1. An admin grants a balance to a user (audio-minutes and/or agent-queries); the grant appends a `topup` movement to `quota_ledger` and updates the wallet.
2. `quota_policies` holds a **default grant** applied to new users plus optional **per-user overrides**.
3. A user sees their remaining balance ("X minutes / Y queries remaining") in the UI (e.g. profile/settings and near the generate/ask actions). Audio is **stored in seconds, displayed in minutes**.
4. When a user is low or empty, the UI nudges them to request a top-up (no self-serve purchase in this phase — admin grant only).

**Frontend**
- Admin: a top-up/grant control in the user-management surface (extends ADM-09's per-user view).
- User: balance display in profile/settings and contextual hints at the generate and ask-agent actions.

**Backend** *(describe only)*
- Admin grant endpoint that appends a `topup` ledger movement and updates the wallet (admin-only, server-enforced).
- Default-grant application on user creation from `quota_policies`; per-user override read at grant/check time.
- User-facing balance read from `quota_wallets`.
- Depends on: QUO-01, ADM-09 (extended user management / per-user usage view).

---

## Data Model

*(Described for planning. No SQL or migrations are created in this task.)*

| Table | Role | Notes |
|---|---|---|
| `usage_log` | **Existing** technical telemetry ledger (tokens, provider, model, audio_seconds). | Unchanged. Powers the ADM-05 AI-usage dashboard. QUO reads alongside it, never replaces it. |
| `quota_ledger` | **New** append-only financial ledger of balance movements (`topup +`, `generate −`, `agent −`). | Source of truth for balances. Carries the QUO-04 dedup key. |
| `quota_wallets` | **New** cached current balance per user (`audio_seconds_remaining`, `agent_queries_remaining`). | O(1) checks; fully derivable from `quota_ledger`. |
| `quota_policies` | **New** default grant + per-user override (admin-grant flow). | Drives the initial grant for new users and overrides per user. |

**Units:** audio balance is stored in **seconds** and displayed to users in **minutes**. Agent balance is a count of queries.

---

## Key Constraints & Learnings

- **Idempotent on retry/restart (NFR-1):** every `quota_ledger` deduction is tied to a dedup key (job/meeting + step + attempt) and written in the **same transaction** as its usage record, so a retried job after a server restart cannot double-deduct.
- **Re-gen draws 0 audio:** re-generating summary/note does not re-transcribe → consumes **0** audio-minute balance; tokens are still logged to telemetry but do not draw down quota.
- **Actor pays:** generation is charged to whoever triggers it; ask-agent is charged to whoever asks (even on shared folders), never the owner.
- **Viewing is free:** transcript/summary/note/playback never consume quota, including for shared meetings.
- **Enforcement, not measurement:** QUO depends on the OBS/usage layer (ADM-05 + `usage_log`); it adds gating on top and does not re-implement metering.
- **No reset:** balances are prepaid and persist; there is no monthly cap or period reset.

---

## Build Order

1. **QUO-01** — schema (`quota_wallets`, `quota_ledger`, `quota_policies`) + atomic balance-update helper. Everything else depends on it.
2. **QUO-04** — idempotent-deduction primitive (dedup key + same-transaction write). Land the correctness guarantee before wiring real spend, so QUO-02/03 use it from day one.
3. **QUO-02** — generate enforcement (pre-flight ffprobe gate + post-success real-duration deduction).
4. **QUO-03** — ask-agent enforcement (pre-check + per-query deduction across share roles).
5. **QUO-05** — admin top-up/grant flow + user balance display.

## Dependencies

- **QUO-01 depends on:** ADM-05 (existing `usage_log` telemetry); AUT-01 (user accounts).
- **QUO-02 depends on:** QUO-01, REC-05 (ffprobe duration), PRP-02/PRP-03 (transcription pipeline).
- **QUO-03 depends on:** QUO-01, RAG-01 (Q&A), COM-05 (folder share roles).
- **QUO-04 depends on:** QUO-01; aligns with REL-03 (idempotent retries) / NFR-1.
- **QUO-05 depends on:** QUO-01, ADM-09 (extended user management).
- **Related (not a dependency):** COM-03 (SaaS billing & per-plan quota) — QUO is the prepaid, admin-grant precursor; COM-03 could later layer Stripe and plans on top.
