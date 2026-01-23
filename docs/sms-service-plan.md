# SMS Service Integration Plan (revised — DMark-only, minimal)

Status: draft — focused, minimal rollout using the DMark SMS API you provided.

Overview
--------
Keep it simple: implement a small DMark SMS client in Go, cache its JWT access token in Redis, and call it from the few places where we previously had placeholders (private-invite, match-found, and mobile-money callbacks). No mock provider or complex background-worker is required for now — just robust, minimal integration that is easy to test and operate.

What we will implement
----------------------
- A lightweight DMark client in `internal/sms` that:
  - fetches an `access_token` from the token endpoint (`/api/get_token/`) using the provided username/password,
  - decodes token `exp` (if present) and caches the token in Redis using a safety buffer (e.g. 90% of ttl),
  - posts SMS messages to `/v3/api/send_sms/` with header `authToken: <access_token>` and JSON payload { msg, numbers, dlr_url, scan_ip }.
- Minimal SMS wiring into three places:
  1. Private match creation: allow an optional `invite_phone` on `POST /api/v1/game/stake` when `create_private=true`, and send the invite SMS after the `match_code` is generated.
  2. Match found: after a match session is created (DB commit in match init), send a short SMS to each player's phone with the game link.
  3. Mobile Money callbacks: on SUCCESS/FAILED, send a payment-confirmation or failure SMS to the payer.
- Small resiliency measures: simple retry (1–2 retries with backoff) for transient network errors, and a per-phone rate limit using Redis (configurable, default ~30s).

Configuration & environment
---------------------------
Add these environment variables and load them in `internal/config/config.go`:

- SMS_SERVICE_BASE_URL (e.g. `https://sms.dmarkmobile.com`)
- SMS_SERVICE_USERNAME (e.g. `testuser2`)
- SMS_SERVICE_PASSWORD (e.g. `T3stUs3r!`)
- SMS_RATE_LIMIT_SECONDS (default: 30)
- SMS_TOKEN_FALLBACK_SECONDS (default: 3000) — fallback when token `exp` cannot be decoded.

We will enable SMS when `SMS_SERVICE_BASE_URL` and credentials are set; development machines can leave those empty to disable SMS.

DMark token & caching behavior
------------------------------
- Fetch token by POST to `{{SMS_SERVICE_BASE_URL}}/api/get_token/` with JSON { username, password }.
- Expect JSON response with `access_token` (JWT). If JWT has `exp`, compute TTL as `exp - now` and cache token in Redis for `floor(0.9 * ttl)` seconds.
- If `exp` is not present or parsing fails, cache for `SMS_TOKEN_FALLBACK_SECONDS`.
- Keep token fetch short and guarded by `singleflight` or allow short races (not required for minimal approach) — token fetch is infrequent due to caching.

Phone formatting
----------------
- DMark expects numbers in `0XXXXXXXXX` form. Implement a helper that converts `+2567XXXXXXXX` or `2567XXXXXXXX` to `0XXXXXXXXX`.

Message templates (examples)
----------------------------
- Private invite: "Join my PlayMatatu private match! Code: {CODE}. Stake: {STAKE} UGX. Expires in {TTL} minutes. Play: {FRONTEND_URL}"
- Match found (to both players): "Opponent found! Play here: {FRONTEND_URL}/g/{TOKEN}?pt={PLAYER_TOKEN}"
- Payment success: "Payment of {AMOUNT} UGX received. Searching for opponent..."
- Payment failed: "Payment of {AMOUNT} UGX failed. Please retry or contact support."

Where to call SMS in the codebase
---------------------------------
- `internal/api/handlers/game.go` (InitiateStake)
  - Add optional `invite_phone` field when `create_private=true`.
  - After inserting private row and generating match code, call SMS client to send invite (and return `sms_invite_sent` flag in response if desired).
- `internal/game/manager.go` (TryMatchFromRedis / JoinPrivateMatch)
  - After the DB transaction commits and `session_id` is available, send the match SMS to both players (use stored phone numbers and generated player tokens / game token for link).
- `internal/api/handlers/momo.go` (HandleMomoCallback)
  - On SUCCESS: send a confirmation to payer (and include link if matched).
  - On FAILED: send a failure notification with next steps.

Auditing / persistence (minimal)
--------------------------------
- Minimal approach: write structured logs (info/error) for each SMS send attempt including provider response and message ID.

Error handling and retries
--------------------------
- On transient errors (HTTP 5xx, timeouts, network errors) do 1–2 retries with small backoff (100–250ms then 500ms), then log failure.
- On 4xx from provider (invalid credentials/payload), log and do not retry.
- Return clear error messages to calling code so upstream handlers can decide whether to report failure to the user (e.g. invite SMS failing is non-fatal for private match creation).

Rate limiting
-------------
- A simple per-phone Redis key (`sms_rate:<phone>`) set with TTL `SMS_RATE_LIMIT_SECONDS` will avoid duplicate sends (e.g., set NX before send). If key exists, skip send and return a rate-limit indicator.

Testing & verification
----------------------
- No unit tests, testing will be manual

Implementation steps (minimal, actionable)
------------------------------------------
1. Add config env vars (and `.env.example`) for DMark credentials.
2. Implement `internal/sms/dmark.go` with:
   - `type DMarkClient struct { baseURL, username, password string; rdb *redis.Client; httpClient *http.Client }`
   - `getAccessToken(ctx) (string, error)` with Redis caching (TTL derived from JWT `exp` when available).
   - `SendSMS(ctx, phone, message) (msgID string, err error)` that does simple retry and rate-limit check.
3. Wire the DMark client into the running server (create in `cmd/server/main.go` and make available to handlers — e.g. set a package-level variable in `internal/sms` or pass into handler constructors as needed).
4. Add `invite_phone` handling to `InitiateStake` and send the invite SMS when a private match is created (do not block on SMS failure; log and return result).
5. After session commit in match initialization (both public and private flows), send match-found SMS to each player.
6. Update `HandleMomoCallback` to send payment success/failure SMS.
8. Deploy to staging and test with real credentials, then enable in production.

Estimated effort
----------------
- DMark client + token caching + tests: ~2–4 hours
- `InitiateStake` invite wiring + frontend input: ~1 hour
- Match-found + momo callback notifications + tests: ~1–2 hours
- Staging verification & minor fixes: ~1–2 hours
- Total: ~5–9 hours

Rollout recommendation
----------------------
- Deploy the DMark client and minimal wiring to staging with the provided credentials.
- Verify invite SMS and match SMS end-to-end.
- If all good, enable in production and monitor logs for errors and rate limits.

If you approve this simplified approach, I will implement steps 1–3 first (config + `internal/sms/dmark.go` + tests). Which environment should I use for initial staging verification (do you want me to use the credentials you provided in the plan)?
