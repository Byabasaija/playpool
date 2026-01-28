# Rematch Feature — Design & Implementation Plan (revised)

Status: Draft

## Goal
When a game ends, show a **Rematch** button. The initiator opens a `Rematch` screen prefilled with the opponent phone and previous stake. The initiator can choose to **Use Winnings** (their own `PLAYER_WINNINGS`) to fund the rematch; otherwise the normal staking flow is used. The opponent receives an invite link (or in-app WS notification) that opens a join screen where they can also opt to **Use Winnings**. If either player selects **Use Winnings** they must verify via OTP (action token) before their stake is accepted.

This plan builds on the existing private-match invite flow and the OTP infrastructure and reuses `InitiateStake`, `GetPlayerProfile`, SMS, and WebSocket components.

---

## Flow (Option A — Invite & Accept, with Winnings toggle)

1) Initiator flow
- On Game Over, user clicks **Rematch** → opens `RematchPage` (pre-filled: opponent phone, previous stake amount).
- Initiator sees **Use Winnings** toggle that displays their `player_winnings` balance (from `GET /api/v1/me`).
- If toggled ON:
  - User clicks **Send Invite**, frontend requests an OTP (`POST /api/v1/auth/request-otp`) to initiator's phone and then verifies (`POST /api/v1/auth/verify-otp-action`) to receive an `action_token` for `stake_winnings` (server stores token in Redis). The initiator's funds are reserved or immediately transferred from `PLAYER_WINNINGS` (server handles debit in the stake creation flow).
  - Then InitiateStake is called with `{ create_private: true, invite_phone: opponent, stake_amount, source: 'winnings', action_token }` which validates the token, debits winnings → escrow (or fee_exempt), and creates the private match with `match_code`.
- If toggled OFF: InitiateStake behaves as normal (deposit/commission path) and creates a private match with `match_code`.
- Server responds `{ status: 'invited', match_code, expires_at }` and sends a `rematch_invite` WS message to the opponent.

2) Opponent flow (accepting)
- Opponent receives WS `rematch_invite` or clicks the SMS/join link, opening the join/rematch screen (join page) with `match_code` prefilled and stake amount shown.
- Opponent sees their `player_winnings` balance (via `GET /api/v1/player/:phone`) and a **Use Winnings** toggle.
- If opponent toggles and chooses Use Winnings:
  - They request an OTP to their phone and call `POST /api/v1/auth/verify-otp-action` to get an `action_token` tied to their phone and `stake_winnings` action.
  - On acceptance the client calls `initiateStake` with `{ phone, stake_amount, display_name, match_code, source: 'winnings', action_token }`. The server validates token and performs the funds move; if the amounts match and both legs are funded, match proceeds and the players navigate into the game.
- If opponent does not use winnings they join via the normal (deposit) path by calling `initiateStake` with `match_code` and pay as usual.

Notes:
- The server enforces stake amount equality and sufficient funds on acceptance.
- If opponent is offline, SMS invite is sent (existing `InitiateStake` behavior with `invite_phone`). The link opens the join page where the opponent may accept and choose to use winnings or deposit funds.

---

## Concrete changes & files to reuse
- `internal/api/handlers/game.go` — extend `InitiateStake` to accept `source` and `action_token` when `match_code` join path is used (reuse earlier `stake-with-winnings` plan's changes). Ensure it supports both creating private matches and accepting join-by-code while validating `action_token` if provided.
- `internal/api/handlers/auth.go` — reuse `RequestOTP` and add `VerifyOTPAction` that issues `action_token` stored in Redis with TTL and single-use semantics.
- `internal/api/handlers/player_helpers.go` — use `GetPlayerProfile` and `GetMe` to surface `player_winnings` to frontend.
- `internal/ws/handler.go` and `ws.GameHub` — send `rematch_invite` messages and handle real-time acceptance notifications.
- Frontend: add `RematchPage` (based on `LandingPage`) and update `GamePage.tsx` to show Rematch button; update join flow to accept `match_code` where `Use Winnings` toggle is available.

---

## Server responsibilities & validations
- Token validation: `action_token` must be single-use, tied to phone and action `stake_winnings` and not expired (use Redis `GET`+`DEL` atomic pattern).
- Balance checks: for `source=='winnings'` ensure `PLAYER_WINNINGS` >= amount; for normal flow validate deposit/settlement.
- Amount equality: when accepting a private match by `match_code`, ensure the stake_amount in the existing private queue matches the amount the accepter is staking (reject mismatch).
- Atomic ledger moves: use `accounts.Transfer` inside DB tx to debit `PLAYER_WINNINGS` → ESCROW (or `PLAYER_FEE_EXEMPT` then follow existing flow) and create account transactions.
- Invite deduplication: when creating a rematch, check for recent private queue for same pair and stake to reuse instead of creating duplicates (optional improvement).

---

## UX details & small behavior decisions
- Show both players' balances on the Rematch / Join screens and a short helper line: “Using Winnings uses your player balance and requires OTP verification.”
- Allow the Initiator to change stake before sending invite, but the final stake must match on acceptance.
- On SMS invites, include a `match_code` param that opens the join screen with `match_code` prefilled.

---

## Race conditions & edge cases
- If initiator funded the match using winnings and the opponent accepts but cannot fund (insufficient winnings and no deposit), return user-friendly error and keep the private match open for a short duration.
- If opponent uses winnings and the action_token is consumed but the DB transfer fails, ensure refunds are attempted and consistent states are restored.
- If both players attempt to accept simultaneously (rare), DB-level checks and the `match_code` join insertion logic should guard against double-joining; ensure atomicity.

---

## Acceptance criteria (manual)
- Initiator can open Rematch screen, see opponent and their winnings balance, toggle Use Winnings, request OTP, verify, and send an invite.
- Opponent clicking invite link or receiving WS invite sees the join screen, can toggle Use Winnings and verify via OTP, and upon acceptance the game starts with both players properly funded.
- If either party lacks winnings, they can still accept via normal deposit flow and join the match.
- Action tokens cannot be reused and expire after TTL.

---

## Implementation tasks (suggested order)
1. Add `action_token` verify endpoint: `POST /api/v1/auth/verify-otp-action` to issue Redis-backed single-use tokens. (backend)
2. Update `InitiateStake` to support `source` + `action_token` for both match creation and join-by-code. (backend)
3. Add `POST /api/v1/game/rematch` convenience endpoint that wraps the private-match path and sends `rematch_invite` WS message. (backend)
4. UI: Add Rematch button to `GamePage.tsx`, create `RematchPage.tsx` (reuse `LandingPage` components) and update Join page to show `Use Winnings` toggle and OTP flow when opened via `match_code`. (frontend)
5. Add server-side logging and rate limiting for rematch invites and `winnings`-funded stakes. (ops/security)

---

If this new plan matches your intent I can update `docs/stake-with-winnings-plan.md` and then start implementing the backend endpoints (1–3) so the frontend can be wired after. Would you like me to begin with the action-token endpoint or with updating `InitiateStake` to accept `source` + `action_token`?