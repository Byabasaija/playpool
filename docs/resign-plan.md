# Concede Feature — Plan

Status: Draft

Goal
- Add a simple, safe "Concede" (aka "Quit and lose") action available during a live game that immediately ends the game and credits the opponent as the winner.
- Keep the UX straightforward: a visible button (e.g., "Concede" or "Quit and lose") with a confirmation modal to prevent accidental concedes.
- Reuse existing forfeit/payout machinery so that payouts, ledger entries, and persistence are consistent.

High-level design
- Frontend: add a prominent but unobtrusive **Concede** button to the in-game UI (`GamePage`). On click show a modal: “Are you sure you want to concede? This will immediately end the match and award the win to your opponent.” Confirming sends a WebSocket message `concede`.

- WebSocket: extend the WS protocol to accept a `concede` message from an authenticated player inside a game. The handler will:
  - Validate the game exists and is still in progress.
  - Confirm the sender is a participant in the game and that game is not already completed.
  - Call `g.ForfeitByConcede(playerID)` (server-side game state method) which:
    - Sets the winner to the opponent, sets `Status = Completed`, `WinType = 'concede'`, sets `CompletedAt`, records an audit move `CONCEDE`, and calls Manager.SaveFinalGameState(g).
  - Broadcast a `player_conceded` (or reuse `player_forfeit` / `game_over`) WS message to both players with reason and final state.

- Backend: Implement `ForfeitByConcede` method on `internal/game/state.go` (mirror behavior of `ForfeitByDisconnect`, but record `CONCEDE` move and set `WinType` to `concede`). Ensure Manager.SaveFinalGameState handles payout (already handles payouts for non-draw games). Add audit logging.

- Edge cases & validations:
  - Disallow concede if game already finished or if game is in a state where a concede would be invalid.
  - Ensure a concede is permissible at any moment (design choice): allow only if game Status == InProgress (recommended).
  - Prevent accidental double-concede actions (server-side idempotency check: if game already completed return error).

- UX considerations:
  - Prompt confirmation modal with clear copy: “You’ll lose this match immediately and your opponent will be declared the winner. Continue?”
  - Optionally show the expected payout/summary if helpful (e.g., “Opponent will receive {UGX}”).
  - For mobile/tiny screens, make the text and placement accessible and easy to confirm.

- Logging & auditing:
  - Manager.RecordMove(sessionID, playerDBID, "CONCEDE", "", "") to ensure the action appears in the final game history.
  - Add server log lines: `[CONCEDE] player X conceded game Y`.

- Rate-limits & abuse prevention:
  - Concede is a negative action that doesn’t expose attack vectors directly, but we still ensure:
    - Only participants can call it.
    - If suspicious (rapid concedes across many games), flag for review.

File-level implementation mapping
- WebSocket handling
  - File: `internal/ws/handler.go`
  - Add new case `case "concede":` in `handleMessage` that calls `handleConcede(g)`.
  - Implement `handleConcede` function in the same file (or in a small helper) to validate and call the game state method.

- Game state
  - File: `internal/game/state.go`
  - Implement `func (g *GameState) ForfeitByConcede(concedingPlayerID string)` which mirrors `ForfeitByDisconnect` but records `CONCEDE` move and sets `WinType = "concede"`. Use Manager.RecordMove and Manager.SaveFinalGameState as in ForfeitByDisconnect.

- Manager (already handles SaveFinalGameState & payouts)
  - File: `internal/game/manager.go` — no change required if `WinType` is set properly and SaveFinalGameState handles payout.

- Frontend
  - File: `frontend/src/pages/GamePage.tsx`
  - Add a `Concede` button somewhere in the game UI (e.g., near pause/leave controls or inside a menu). On click, show confirmation modal. On confirm, send WS message `{ type: 'concede' }` to server.
  - After WS `player_forfeit` / `game_over` arrives, UI will show final screen (already implemented) with winner and payouts.

- Types & client code
  - Add `concede` to client WS message type definitions (`frontend/src/types/websocket.types.ts`) if present.

Acceptance criteria (manual)
1. During a live game, a player sees a **Concede** / **Quit and lose** button.
2. Confirming the button sends a WS `concede` message and the game ends immediately.
3. The opponent receives a `game_over` / `player_forfeit` message and is declared winner. Payout handling is performed as for other completed games and logged.
4. Attempts to concede when the game is already over return an appropriate error message and no additional changes are made.
5. The concede action is idempotent (repeated requests after completion are harmless or return a benign error).

Testing notes (manual)
- Happy path: Player A concedes → Player B receives win and payout; DB `game_states` & `transactions` reflect the outcome.
- Race path: concede immediately followed by player action — ensure server serializes finalization (mutexes in GameState should ensure consistency).
- Invalid path: spectator or non-player attempts to send `concede` → server returns error.

Implementation tasks (suggested order)
1. Add `ForfeitByConcede` method to `internal/game/state.go` (small).
2. Add WS handler case for `concede` in `internal/ws/handler.go` and a helper `handleConcede` that validates and calls `g.ForfeitByConcede` (small).
3. Add frontend button + modal in `frontend/src/pages/GamePage.tsx` that sends WS `concede` message when confirmed (small).
4. Test manually end-to-end and verify DB ledger and payouts via `SaveFinalGameState`. (manual)
5. Add logging and minor UX polish (small).

Questions / choices
- Naming for `WinType`: prefer `concede` or `forfeit`? (I recommend `concede` to be explicit in history.)
- Do we want an undo grace period (short window to cancel concede)? My recommendation: **no** — concede should be final and clear to avoid complexity.

If you approve, I can add the server-side `ForfeitByConcede` and the WS message handling first (so it's secure and server-driven), then wire up the frontend button and modal. Which part should I start with?