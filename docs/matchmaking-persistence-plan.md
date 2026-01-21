# Matchmaking Persistence & Escrow Plan

Status: Draft

## Summary
This plan captures the safe, incremental approach to make matchmaking durable and auditable while keeping a fast operational path. We will use the existing `matchmaking_queue` DB table as the authoritative ledger and introduce a Redis operational queue for low-latency matching. Ledger changes will be explicit and traceable (queue_id / session_id references), and platform fees will be recorded as a flat, configurable fee.


## Goals
- Ensure queued players are not lost on server restarts (durability).
- Keep low-latency and atomic matching for high concurrency.
- Provide clear accounting for: stake, platform flat fee, escrow pot, payouts.
- Preserve phone-as-primary identity and minimal player profiles.
- Avoid immediate refunds on expiry; hold stake as credit (policy to be defined later).


## Current context / inventory
- Existing DB tables: `players`, `transactions`, `escrow_ledger`, `game_sessions`, `matchmaking_queue` (migration exists), `game_moves`, `disputes`.
- Current runtime: an in-memory `GameManager.matchmakingQueue` (not persisted) and Redis used for game state save/load but not as the operational queue.


---

PHASE A — Durable DB ledger + Redis operational queue (safe, pragmatic)

1) Key ideas
- Persist every stake to `matchmaking_queue` (status='queued', transaction_id, created_at, expires_at, etc.).
- Insert an associated ledger entry for STAKE_IN and COMMISSION that references `queue_id` (ledger rows are auditable).
- Push `queue_id` to Redis into a per-stake list key: `queue:stake:{amount}` for fast atomic pops.
- Matching workers pop `queue_id` from Redis and atomically claim the DB row (UPDATE ... WHERE status='queued' RETURNING id); on success create a session and set `status='matched'`/`session_id`.
- On startup: rehydrate Redis from DB for rows still `status='queued'` and not expired.

2) DB schema notes / minimal additions
- Ensure `matchmaking_queue` has: id (queue_id), player_id or phone_number, stake_amount, transaction_id, status (queued|matching|matched|expired), created_at, matched_at NULLABLE, expires_at, session_id NULLABLE.
- Add `queue_id` (nullable) to `escrow_ledger` so pre-match STAKE_IN and COMMISSION entries can reference the queue row.
- (Optional) `accounts` table to hold platform/escrow account balances for clear reconciliation.

3) Ledger flow at stake time
- Create `Transaction` (STAKE, total = stake + flat_fee).
- Insert `matchmaking_queue` row (status='queued', transaction_id, expires_at=now+TTL).
- Insert `escrow_ledger` entries with `queue_id` reference:
  - STAKE_IN of `stake` amount
  - COMMISSION of `flat_fee` to platform account

4) Matching
- Workers pop `queue_id` from Redis (fast). For each `queue_id`:
  - Try to `UPDATE matchmaking_queue SET status='matching' WHERE id=$1 AND status='queued' RETURNING ...` (atomic claim). If no row returned, skip (race lost).
  - If claimed, create the `game_session`, set `session_id` on queue row and set `status='matched'`.
  - Update ledger/session entries as appropriate.

5) Expiry & cleanup
- On `expires_at` < now, worker marks queue row `expired` and does not auto-refund. Per policy, create ledger CREDIT/REFUND action to hold funds as player credit (not automated refund).
- A periodic expiry job performs these updates and triggers any required business flows.

6) Rehydrate (startup)
- At manager startup: `SELECT id FROM matchmaking_queue WHERE status='queued' AND expires_at > NOW() ORDER BY created_at` and push the ids into their respective `queue:stake:{amount}` lists in Redis to re-populate the operational queue.
- If Redis is present and already populated do nothing; ensure not to double-rehydrate.

7) Fallback / resilience
- If Redis is down, perform DB-only claiming using `UPDATE ... WHERE status='queued' ORDER BY created_at LIMIT 1 RETURNING id` or `SELECT FOR UPDATE SKIP LOCKED` to claim items.
- Design matches to be idempotent and log attempts and failures for manual reconciliation.


---

PHASE B — Harden and scale

- Replace per-list pop with a small Lua script for advanced claiming semantics (e.g., move-to-processing list and set visibility timeout) to recover partially-processed items.
- Add Redis persistence settings (AOF) and replication/Sentinel for availability.
- Add monitoring and alerts for queue length, claims/sec, and expired rows.


Manual validation checklist (for QA/manual testing)
- Stake flow: placing a stake inserts a DB queue row and pushes an id to Redis.
- Matching: create a test worker that pops from Redis and claims row in DB, creates session, and updates DB and ledger.
- Rehydrate: restart the app, ensure pending queued rows repopulate Redis and are matchable again.
- Expiry: set a short TTL for testing and verify the expiry job moves rows to EXPIRED and ledger entries are created (no auto-refund).


Config & parameters (example)
- QUEUE_EXPIRY_MINUTES (e.g., 10)
- PLATFORM_COMMISSION_FLAT (e.g., 1000)
- REDIS_KEY_PREFIX = `queue:stake:`
- REHYDRATE_ON_START = true


Acceptance criteria
- A restart does not drop queued players (they remain persisted and requeued).
- Matching is atomic and race-free (DB claim succeeds exactly once per queued row).
- Ledger contains STAKE_IN and COMMISSION entries for each queued stake.
- Expired rows are identifiable and handled according to policy (no auto-refund, ledger credit created).


Next actions I can take (pick one)
1. Draft DB migration(s) to add `queue_id` to `escrow_ledger`, ensure `matchmaking_queue` columns exist, and optionally add an `accounts` table.
2. Implement Phase A: persist-on-stake + push-to-Redis + rehydrate + expiry job + DB claim fallbacks.

Tell me which next action to do and I’ll prepare a focused plan or implementation PR.
