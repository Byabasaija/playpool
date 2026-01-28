# Stake Using Winnings (OTP-verified)

Status: Draft (updated with project-specific details)

## Goal
Allow players to fund a stake directly from their `PLAYER_WINNINGS` account via an OTP-verified flow on the Home / New Game page. The flow should be a one-step stake (no separate conversion) and remain tax-free.

## What already exists we can reuse
- OTP generation and verification: `RequestOTP` and `VerifyOTP` in `internal/api/handlers/auth.go` (uses Redis keys `otp:{phone}` and `sms.SendSMS`). Request rate-limiting and TTL are already implemented.
- Player profile endpoint: `GetPlayerProfile` in `internal/api/handlers/player_helpers.go` — returns `fee_exempt_balance` and expired queue info.
- Stake initiation: `InitiateStake` in `internal/api/handlers/game.go` — current flow creates a deposit (credits `PLAYER_FEE_EXEMPT`) and inserts a `matchmaking_queue` row. It uses `accounts.Transfer` and the existing accounts/ledger utilities.
- Account transfer helper: `accounts.Transfer(...)` (used across handlers) for atomic ledger moves.
- Redis client (`rdb`) is available to handlers and already used for OTP storage.

These existing pieces let us implement the feature with minimal new primitives (we'll add a short action-token layer on top of the existing OTP) and modify `InitiateStake` to accept and verify action tokens.

## Revised API & Implementation plan (code-oriented)

1) Add `player_winnings` to `GET /api/v1/player/:phone`
- File: `internal/api/handlers/player_helpers.go`
- Use: `accounts.GetOrCreateAccount(db, accounts.AccountPlayerWinnings, &p.ID)` to fetch the balance and include `player_winnings` in the JSON response.
- Frontend: update `getPlayerProfile` in `frontend/src/utils/apiClient.ts` to return `player_winnings`.

2) Add OTP-for-action verification endpoint
- New handler: `VerifyOTPAction(db, rdb, cfg) gin.HandlerFunc` in `internal/api/handlers/auth.go`.
- Route: add `v1.POST("/auth/verify-otp-action", handlers.VerifyOTPAction(db, rdb, cfg))` in `internal/api/routes.go`.
- Behavior: Accept `{ phone, code, action }` (action = `stake_winnings`), verify the OTP using the same Redis `otp:{phone}` hashing as `VerifyOTP`, then *instead of returning a JWT* generate a short random `action_token` (hex or base32), store in Redis as `action_token:{token}` with JSON payload { phone, action, player_id, created_at } and TTL (reuse `cfg.OTPTokenTTLSeconds` or add `ActionTokenTTLSeconds` config). Return `{ action_token, expires_at }` to client.
- Security: delete `otp:{phone}` on successful verify (existing behavior). Persist audit logs.

3) Extend stake initiation to accept winnings as source
- File: `internal/api/handlers/game.go` (function `InitiateStake`)
- Change request struct to accept optional fields: `Source string 'json:"source,omitempty"'` and `ActionToken string 'json:"action_token,omitempty"'`.
- If `Source == "winnings"`:
  - Validate `ActionToken`: check Redis `action_token:{token}` exists, ensure payload.action == `stake_winnings`, and that phone or player_id matches the intended player. Use an atomic GET+DEL (Lua or single command pattern) to prevent reuse.
  - Within the existing DB transaction area, instead of doing the settlement/commission flow, perform a single `accounts.Transfer(tx, winningsAcc.ID, playerFeeAcc.ID, netAmount, "TRANSACTION", ...)` or directly from `PLAYER_WINNINGS` → `ESCROW` depending on desired ledger semantics. (Preferred: credit to `PLAYER_FEE_EXEMPT` so the rest of the stake flow is unchanged.)
  - Record a `transactions` row for the stake (similar to existing behavior).
- Keep normal matching/queue insertion logic unchanged after funds are placed in `PLAYER_FEE_EXEMPT`.
- Ensure action_token is consumed (deleted) atomically so it cannot be reused for multiple stakes.

4) Redis single-use logic
- For `action_token` verification use an atomic get-and-delete pattern (Lua script or `GET` followed by `DEL` guarded by checking returned payload). This prevents race conditions.
- TTL: 5 minutes (configurable); reuse `OTPTokenTTLSeconds` or add a dedicated config value.

5) Minimal client-side changes
- `frontend/src/utils/apiClient.ts`: extend `initiateStake` signature to accept optional `{ source?: string; action_token?: string }` and include them in the POST body.
- `frontend/src/pages/LandingPage.tsx`: add a **Use Winnings** toggle and a compact panel when toggled on:
  - On phone blur (existing `handlePhoneBlur`) we already fetch `getPlayerProfile`; extend it to display `player_winnings`.
  - Add **Send OTP** button that calls `POST /api/v1/auth/request-otp` (existing handler) for the phone.
  - Add inline code input + verify button that calls `POST /api/v1/auth/verify-otp-action` with `{ phone, code, action: 'stake_winnings' }` and stores the returned `action_token` in component state (memory only).
  - When user submits the stake with Use Winnings toggled, call `startGame(full, stake, displayName, { source: 'winnings', action_token })` — update `startGame`/`initiateStake` to send those fields through.
  - Handle error paths (token expired, insufficient winnings, invalid token) and show messages.

## Security & policy notes (practical)
- Use the existing OTP rate-limiting in `RequestOTP`; this prevents bulk SMS abuse.
- Require short TTL and single-use action tokens to limit replay risk.
- Consider requiring OTP for signed-in players too (config flag `REQUIRE_OTP_FOR_WINNINGS`).
- Add server-side checks for max stake-from-winnings per request plus daily limits to reduce fraud risk.

## Manual acceptance criteria
- `GET /player/:phone` returns `player_winnings` (visible in Landing page when phone entered).
- OTP send/verify for action produces an `action_token` and returns expiry.
- Stake submission with `{ source:'winnings', action_token }` succeeds when funds available and creates a queue entry.
- `PLAYER_WINNINGS` account is debited and `PLAYER_FEE_EXEMPT` (or ESCROW as chosen) credited; ledger entries exist.
- Reusing the same `action_token` fails.

## Implementation tasks (concrete file-level tasks)
1. Edit `internal/api/handlers/player_helpers.go` — include `player_winnings` in `GetPlayerProfile`. (small)
2. Add `VerifyOTPAction` handler to `internal/api/handlers/auth.go` and route it in `internal/api/routes.go` as `POST /auth/verify-otp-action`. (small)
3. Update `internal/api/handlers/game.go` `InitiateStake` to accept `source` + `action_token`, verify action tokens via Redis, and on `source=='winnings'` perform `accounts.Transfer` from `PLAYER_WINNINGS` to `PLAYER_FEE_EXEMPT` (or ESCROW) inside the existing tx path. (medium)
4. Frontend: update `frontend/src/utils/apiClient.ts` (`initiateStake`) and `frontend/src/pages/LandingPage.tsx` to add Use Winnings UI, OTP send/verify flow, and include `action_token` on stake submit. (medium)
5. Small configs & docs: add/annotate `ActionTokenTTLSeconds` if desired; document feature in `docs/stake-with-winnings-plan.md`. (small)

> Note: per your preference I will not add unit or integration tests — we will do manual verification.

---

If this updated plan looks good I can start by adding `player_winnings` to the player profile handler and then implement `VerifyOTPAction` and `InitiateStake` changes. Which file would you like me to modify first? If you prefer, I can start with the frontend UI and mock the new endpoints while the backend is implemented.