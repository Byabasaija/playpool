# Idle Forfeit Plan

Goal
- Detect when a player is connected but idle (not sending game actions) and resolve games where a player is unresponsive.
- Behavior: send a warning after 45s of inactivity and automatically forfeit the inactive player after 90s. When forfeited, the active player wins and is immediately paid the stake (no other penalties).

High-level design
- Use Redis as a lightweight scheduler (sorted sets) to scale to many concurrent games without scanning all games.
- Keep server logic simple and deterministic: the worker looks up due events in Redis, validates current activity state, and only then performs warning or final forfeit+pay.

Key components
- Redis keys
  - `idle_warning` (zset): members `game:<gameID>:player:<playerID>`, score = unix-ts when warning should fire (lastActive + warnSec).
  - `idle_forfeit` (zset): same member format, score = unix-ts when forfeit should fire (lastActive + forfeitSec).
  - `last_active:{gameID}:{playerID}` (string): stores latest unix-ts of the player activity (can be a Redis string or a small hash).
  - Pub/sub channel `idle_events` used by the worker to publish events for the WS layer to broadcast to players.

- Worker (single process or small pool)
  - Poll interval (configurable, small, e.g. 1–5s).
  - On each loop:
    - `ZRANGEBYSCORE idle_warning -inf now` → for each entry: ZREM; check `last_active`; if still stale (older than warn threshold) publish a `player_idle_warning` event (with `forfeit_at` timestamp). If last_active was updated, skip.
    - `ZRANGEBYSCORE idle_forfeit -inf now` → for each entry: ZREM; check `last_active`; if still stale (older than forfeit threshold) call the in-memory manager `ForfeitByDisconnect` (finalize session) and perform payout to the winner; then publish `player_forfeit` (or `game_over`) event on `idle_events` for the WS layer.

- WS layer
  - Subscribe to `idle_events` and broadcast messages to the relevant game room:
    - `player_idle_warning` → message payload: `{ type: 'player_idle_warning', player: <playerID>, game_id: <gameID>, forfeit_at: <ISO ts>, seconds_left: <n> }`
    - `player_forfeit` / `game_over` → payload: `{ type: 'game_over', game_id: <gameID>, winner: <playerID>, reason: 'idle_forfeit' }`
  - Clients show a small non-blocking banner or inline notice and a countdown based on `forfeit_at`.

Server-side detail notes
- On every player WS message (any valid game action), update `last_active:{gameID}:{playerID}` and `ZADD` both `idle_warning` and `idle_forfeit` with new due timestamps. This replaces previous entries.
- Worker must always validate the authoritative `last_active` before acting — this guarantees correctness even if the player acts during the tiny window when a warning or forfeit is being processed.
- Use DB transactions when finalizing a forfeit and performing payouts to ensure ledger consistency.

Payout behavior
- When a forfeit occurs the session is marked completed and the winner receives the full stake (transfer escrow to winner using existing account/ledger code). No other penalties.

Configuration
- IDLE_WARNING_SECONDS (default 45)
- IDLE_FORFEIT_SECONDS (default 90)
- IDLE_WORKER_POLL_INTERVAL_SECONDS (e.g., 1–5)

Monitoring & logging
- Log warnings and forfeits with gameID, playerID and timestamps.
- Track counters (warning_sent, forfeits_executed) for operational visibility.

Rollout notes
- Add config flags and enable in staging.
- Manually test with a couple of games (simulate inactivity) to verify warnings, countdown, and automatic payout.
- After verifying, enable on production.

Notes (no tests included per request)
- This plan avoids scanning all games and scales well with large numbers of concurrent games.
- The logic is deterministic (worker validates lastActive) and is resistant to races (activity wins).
