# Private Match (Join-by-Code) Feature Plan

Status: approved for implementation (6-char codes, single-use, stake parity)

Overview
--------
Allow players to create private matches and invite friends by short codes. Creator deposits as usual and receives a 6-character code; the friend deposits and supplies the code to claim the creator's queue row and start the session atomically.

Goals
-----
- Minimal risk to current public FIFO matching flow
- Single-use, time-limited, user-friendly 6-char codes
- No admin involvement in normal invite flows (admin tools only for audit/revoke)
- Preserve existing accounting / escrow flows

Design Summary
--------------
- Code charset: Crockford-base32 (uppercase letters + digits excluding ambiguous chars)
- Default code length: 6 characters
- TTL for private codes (configurable): 10–15 minutes (default 10m)
- Single-use codes (invalid after match or expiry)
- Join requires stake parity (creator stake == joiner stake)

DB Changes (migration)
-----------------------
- Add columns to `matchmaking_queue`:
  - `match_code TEXT NULL UNIQUE`  -- unique index
  - `is_private BOOLEAN NOT NULL DEFAULT FALSE`
- No other schema changes required.
- Add index: `CREATE UNIQUE INDEX idx_matchmaking_queue_match_code ON matchmaking_queue(match_code);`

API Surface (minimal)
----------------------
Two approaches considered; recommended: extend existing stake endpoint (one endpoint minimal surface).

Approach A (recommended - extend POST /api/v1/game/stake):
- Request body additions:
  - `create_private: boolean` — if true, create a private queued entry and return code
  - `match_code: string` — if provided, attempt a join-by-code claim; must supply matching stake
- Responses:
  - For `create_private=true`: 201/OK with { queue_id, match_code, expires_at }
  - For `match_code=...` + deposit: either immediate matched response (session created) or an error (invalid/expired/wrong stake)

Approach B (optional - explicit endpoints):
- POST /api/v1/game/private — create private match (returns match_code)
- POST /api/v1/game/join-code — join with code (request includes match_code and stake)

Atomic Join Claim Logic
-----------------------
- Claim query: `UPDATE matchmaking_queue SET status='matching' WHERE match_code=$1 AND status='queued' AND expires_at > NOW() RETURNING id, player_id, phone_number, ...`
- If claim returns a row, run the exact same session-initialization & reserve-stake flow (inside a DB tx) that normal Redis-based matching uses (insert game_sessions, reserve both stakes → escrow ledger rows, update queue rows to matched with session_id). If any step fails, rollback and revert queue status.
- If claim returns no row → error (expired/not found/used).

Concurrency & Collisions
------------------------
- Code uniqueness guaranteed by UNIQUE index.
- Code generation: random generation + attempt insert/update with retry loop (3–5 attempts) on conflict.
- Collision probability with 6 chars base32 negligible for expected load.

UX Flows
--------
Web (recommended):
- Creator: select stake → toggle "Create private match" → server deposits & returns `{match_code, expires_at}` → Show code panel (copy, share, TTL). Optional cancel button.
- Joiner: select stake → enter match code (or "Join with code" field) → server attempts claim + returns matched response or error.

USSD (simple):
- Menu includes "Invite a friend".
- Creator selects stake → choose "Invite friend" → USSD shows code (and `Expires in X min`). Optionally prompt to enter friend phone to send SMS (if supported).
- Joiner selects "Join with code" → input code → server attempts claim.

Rules & Validation
------------------
- Require stake parity by default (recommended) — reduce payout disputes.
- Single-use: when joined successfully, mark queue rows as `matched` and clear/ignore match_code for replay.
- Expiry: TTL enforced by existing expiry job (ExpireQueuedEntries); expired private rows behave as expired queued rows (converted to player credit if applicable).
- Rate-limit join attempts per IP to mitigate brute-force.

Admin & Audit
-------------
- Add admin endpoints to list private matches, revoke/cancel codes, and view claims in audit logs.
- Record creation and claim events in `account_transactions` and optionally `admin_audit` (recommended for operator actions such as manual revoke).
- Admin should never be required to generate invites; admin UI only for investigation & manual correction.

Monitoring & Observability
--------------------------
- Log code generation, claim attempts, failures (invalid/expired/mismatch), and TTL expiries.
- Include these events in normal application logs and optionally send to central logging.

Testing & Rollout
-----------------
- Manual tests to exercise generator/claim/reservation flows:
  - Create private match → verify row in `matchmaking_queue` with match_code & is_private
  - Join with correct code & stake → verify session created, escrow ledger STAKE_IN inserted, queue rows updated
  - Join with wrong stake → verify error and no DB change
  - Expiry: create private match & wait TTL → verify expiry job marks row `expired`
- Release plan: deploy migration → deploy backend changes → enable feature in frontend as an opt-in flag for testing → enable for users

Config & Tuning
---------------
- `MATCH_CODE_LENGTH` (default 6)
- `MATCH_CODE_TTL_MINUTES` (default 10)
- Rate limits on join attempts and code generation

Security
--------
- Use TLS for all UI/API traffic (including USSD callbacks if sending code via SMS).
- Rate-limit and log suspicious join attempts.
- Require same-stake parity to lower fraud exposure.

Implementation Steps (developer tasks)
-------------------------------------
1. Add migration to add `match_code` (TEXT UNIQUE) and `is_private` (BOOLEAN) to `matchmaking_queue`.
2. Backend:
   - Add code generator utility (Crockford base32 6 chars) with retry-on-conflict.
   - Extend POST /api/v1/game/stake to support `create_private` and `match_code` parameters (or create two small endpoints if preferred).
   - Implement claim flow: atomic DB claim + session init (re-using existing reserveStakeForSession logic) with proper logging and rollback.
   - Add admin endpoints to list/revoke private matches (protected by admin auth).
3. Frontend:
   - Landing: "Create private match" toggle + Code display and copy/share UI
   - Join flow: add input for match code during stake
4. USSD:
   - Add brief flow for create/show code; optionally prompt for phone number to SMS (if SMS available).
5. Add logging/audit of key events.
6. Manual testing & rollout.

Estimated effort (rough):
- Backend + migration: 4–6 hours
- Frontend small UI + USSD tweak: 3–4 hours
- Testing & rollout: 1–2 hours

---
If you approve, I’ll implement the DB migration and the backend handling (extend stake handler + atomic claim) first; then add the minimal frontend snippets and the USSD message formatting. Want me to start?
