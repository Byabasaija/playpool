# Accounts & Credits Implementation Plan

Status: Draft

This document describes a minimal, auditable, and practical implementation for player wallets, escrow, and platform accounts that supports the matchmaking persistence work already planned (Phase A/B).

Goals (concise)
- Provide durable player wallets so wins/expired-stakes are recorded as credits usable for future stakes.
- Keep platform fees as a flat configurable fee, credited to a PLATFORM account (deducted at deposit time).
- Apply a configurable payout tax (default 15%) on winnings when paying out from ESCROW to winners.
- Keep an ESCROW account that holds money for matches until they settle.
- Ensure all movements are auditable via account transactions (double-entry style or ledger rows with clear references).
- Keep UX smooth: when a stake was previously charged and later expired, automatically convert the stake to a fee-exempt credit which can be reused without charging commission again; when a player has such an unplayed stake, force a "Requeue" UX (do not ask them to restake).

Key concepts and rules
- Commission at deposit time is a flat fee (CONFIG: `COMMISSION_FLAT`). It is captured immediately when the player deposits for a stake and credited to the PLATFORM account.
- All un-played funds live in `PLAYER_FEE_EXEMPT` (the account that holds deposited but not-yet-placed-in-ESCROW funds). When a user deposits for a stake we deduct `COMMISSION_FLAT` and credit the remaining net amount to `PLAYER_FEE_EXEMPT`.
- On match initialization we move funds from `PLAYER_FEE_EXEMPT` into ESCROW (atomic). No additional commission is taken at initialization.
- When paying the winner, apply a payout tax (CONFIG: `PAYOUT_TAX_PERCENT`, default 15%). The payout tax portion is credited to PLATFORM; the remainder is credited to the winner's `PLAYER_WINNINGS` account.
- If a queued stake expires, an automated expiry job will mark the queue row `expired` and ensure any STAKE_IN is converted back (or represented) as `PLAYER_FEE_EXEMPT` credit (no additional commission on reuse).

Data model changes (DB)
- `accounts` (new)
  - id, account_type ENUM (PLAYER_FEE_EXEMPT | PLAYER_WINNINGS | PLATFORM | ESCROW), owner_player_id NULLABLE, balance DECIMAL, created_at, updated_at
- `account_transactions` (new)
  - id, debit_account_id, credit_account_id, amount, reference_type (e.g., TRANSACTION, QUEUE, SESSION), reference_id, description, created_at
- `matchmaking_queue` adjustments
  - ensure `status` ENUM (queued | processing | matched | expired) and add `converted_to_credit_at TIMESTAMP NULLABLE` for idempotent expiry conversions
- Modify `escrow_ledger`: ensure STAKE_IN and COMMISSION rows reference the `queue_id` and can be reconciled with `account_transactions` when deposits / conversions occur.

Flows (detailed)

1) UI / phone entry
- When a player enters their phone number, the server returns their profile plus available `PLAYER_FEE_EXEMPT` balance and whether they have an expired/eligible stake. If they do, the UI shows "You have pending stake UGX X — Requeue" and the primary action becomes REQUEUE (forced requeue flow; do not ask for a new stake).

2) Deposit (stake creation)
- Player pays (MM or dummy in dev). The server:
  - Records the incoming transaction (transactions table) for the gross amount.
  - Immediately deducts `COMMISSION_FLAT` and creates an `account_transactions` entry that credits PLATFORM with the commission and debits the MM/clearing placeholder.
  - Credits the net amount (gross - COMMMISSION_FLAT) to `PLAYER_FEE_EXEMPT` (account transaction). This means all un-played stake funds sit in `PLAYER_FEE_EXEMPT`.
  - Insert `matchmaking_queue` row (status=queued) and link deposit via transaction_id/queue_id.

3) Matching & Game initialization (atomic)
- When a match is claimed (both sides successfully reserved), inside an atomic DB transaction:
  - For each player, debit PLAYER_FEE_EXEMPT for the stake amount (use SELECT FOR UPDATE) and credit ESCROW with the stake amount.
  - Mark both matchmaking_queue rows as matched and create the `game_session` row.
  - If any debit fails (insufficient funds, race), rollback and the claim fails; the other player is returned to queue accordingly.

4) Match completion (payout)
- When the game completes, compute the pot and apply payout tax (CONFIG: `PAYOUT_TAX_PERCENT`, default 15%). Then inside a DB transaction:
  - Debit ESCROW for the winner's payout gross amount.
  - Credit PLATFORM with the payout tax portion (account_transaction).
  - Credit WINNER's `PLAYER_WINNINGS` account with (pot − payout_tax) (account_transaction).
  - Record a `PAYOUT` transaction row linked to the session.

5) Queue expiry (AUTOMATED)
- Background expiry job finds queued entries past `expires_at`. For each expired queue row, idempotently:
  - Mark `matchmaking_queue.status = 'expired'` and set `converted_to_credit_at`.
  - Ensure net deposited funds related to that queue (previously contributed to PLAYER_FEE_EXEMPT) remain available to the player as fee-exempt credit (no commission charged again). If a STAKE_IN already exists in escrow for that queue, reconcile by moving back to `PLAYER_FEE_EXEMPT` (debit ESCROW, credit PLAYER_FEE_EXEMPT) and create `account_transactions` linked to the `queue_id`.

6) Requeue (UI & API)
- If the player has sufficient `PLAYER_FEE_EXEMPT` for the stake, the UI forces “Requeue” instead of asking for a new deposit. POST `/api/v1/player/:phone/requeue` will consume the `PLAYER_FEE_EXEMPT` funds and create a new `matchmaking_queue` entry (no commission applied at requeue because the commission was taken at the original deposit).
- Partial credit flows are not supported; requeue requires a full `PLAYER_FEE_EXEMPT` balance to cover the stake. If the player does not have sufficient fee-exempt credit they must make a new deposit (normal deposit flow).

Operational details
- All account moves use DB transactions with SELECT FOR UPDATE to avoid races.
- Expiry conversion is idempotent and guarded (converted_to_credit_at). Recovery jobs and Redis claim patterns remain the same.
- Audit trail: every movement links to `queue_id`/`session_id`/`transaction_id` for reconciliation.

Admin API & UI (minimal)
- Protect admin endpoints with `ADMIN_TOKEN` checked by middleware (header `X-Admin-Token`).
- `/pm-admin` UI: operator enters admin token (password input). The UI stores the token for the session and sets `X-Admin-Token` on admin API calls. Use TLS.
- Minimal admin endpoints:
  - GET `/admin/accounts` — list accounts and balances
  - GET `/admin/account_transactions` — paginated ledger
  - POST `/admin/queue/:id/credit` — manual conversion of an expired queue into player credit (for corrections)

Acceptance criteria
- Commission (`COMMISSION_FLAT`) is deducted at deposit and credited to PLATFORM on deposit.
- Deposited funds (net of commission) are held in `PLAYER_FEE_EXEMPT` and are used for requeues or moved into ESCROW when games initialize.
- On payout, payout tax (CONFIG: `PAYOUT_TAX_PERCENT`, default 15%) is applied; payout tax goes to PLATFORM and winner gets net credited to `PLAYER_WINNINGS`.
- Expired stakes are converted automatically into fee-exempt credits and a player with credit sees a forced "Requeue" UX. Requeue requires full coverage by `PLAYER_FEE_EXEMPT` (partial-credit combinations are not supported).
- All operations are auditable and race-safe.

Next steps (pick one)
1. Draft SQL migrations for `accounts` (with `PLAYER_FEE_EXEMPT` and `PLAYER_WINNINGS` account types), `account_transactions`, add `matchmaking_queue.converted_to_credit_at TIMESTAMP NULLABLE`, and add `PAYOUT_TAX_PERCENT` config.
2. Implement the DB and handler code for deposit (deduct commission → credit PLAYER_FEE_EXEMPT), atomic match initialization (debit FEE_EXEMPT → credit ESCROW), automatic expiry conversion, requeue endpoint, and payout tax application.

Tell me which next step you want me to do and I'll prepare the migrations and API signatures or start implementing them now.
