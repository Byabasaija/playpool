# Admin Authentication Plan — Phone + Token + OTP

Status: Draft

## Summary ✅
This document defines a minimal, practical admin authentication flow using: **phone + admin token + SMS OTP → short-lived admin session token**. It reuses existing OTP infrastructure and is designed to be easy to operate while substantially improving security over a single shared static token.

## Goals
- Provide a simple, secure way for operators to authenticate to the `/pm-admin` UI and protected admin APIs.
- Avoid heavy infra changes (reuse existing OTP and Redis infrastructure).
- Make critical admin actions auditable and optionally require a secondary per-action confirmation.

## High-level flow 🔁
1. Operator visits `/pm-admin` and submits **phone** and **admin token**.
2. Server verifies the token matches an `admin_accounts` entry for that phone and sends OTP using existing `RequestOTP` logic (store context in Redis).
3. Operator enters the OTP; server verifies via `VerifyOTPAction` (or a new `VerifyOTPAdmin`) and issues a short-lived **admin_session** token (opaque, stored in Redis) returned to the client.
4. Client stores `admin_session` in `sessionStorage` and includes it on all admin API calls using `Authorization: Bearer <token>` or `X-Admin-Session` header.
5. Sensitive actions (e.g., manual balance adjustments or refunds) require either a re-OTP or an additional single-use `action_token` obtained by re-verifying OTP.

## Minimal endpoints (first iteration) 🔧
- POST `/api/v1/admin/request-otp` — body { phone, token }
  - Validate phone + token relationship. If valid, send OTP using existing OTP mechanism and return 200.
- POST `/api/v1/admin/verify-otp` — body { phone, otp }
  - Verify OTP; on success create admin_session token (store in Redis with TTL, e.g. 15m) and return { admin_session: "...", ttl_seconds }.
- GET `/api/v1/admin/accounts` — list accounts & balances (protected)
- GET `/api/v1/admin/account_transactions` — paginated ledger with filters (protected)
- GET `/api/v1/admin/transactions` — paginated ledger and transaction reports with filter options (account_id, player_phone, date_range) (protected)
- GET `/api/v1/admin/stats` — platform statistics (total stakes, commissions, active games, pending withdrawals, per-day totals) (protected)

Notes: All `/api/v1/admin/*` routes are protected by `AdminSessionMiddleware` that checks the session token in Redis.

## Data model / schema (minimal)
- `admin_accounts`:
  - phone TEXT PRIMARY KEY
  - display_name TEXT
  - token_hash TEXT (bcrypt)
  - roles TEXT[] (optional)
  - allowed_ips TEXT[] (optional)
  - created_at TIMESTAMP, updated_at TIMESTAMP

- `admin_sessions` (optional — could be Redis-only):
  - token TEXT PRIMARY KEY
  - phone TEXT REFERENCES admin_accounts(phone)
  - expires_at TIMESTAMP
  - created_at TIMESTAMP

- `admin_audit`:
  - id SERIAL PRIMARY KEY
  - admin_phone TEXT
  - ip TEXT
  - route TEXT
  - action TEXT
  - details JSONB
  - success BOOLEAN
  - created_at TIMESTAMP

## Example migration (skeleton)
```sql
-- Create admin_accounts
CREATE TABLE IF NOT EXISTS admin_accounts (
  phone TEXT PRIMARY KEY,
  display_name TEXT,
  token_hash TEXT NOT NULL,
  roles TEXT[],
  allowed_ips TEXT[],
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create admin_audit
CREATE TABLE IF NOT EXISTS admin_audit (
  id SERIAL PRIMARY KEY,
  admin_phone TEXT,
  ip TEXT,
  route TEXT,
  action TEXT,
  details JSONB,
  success BOOLEAN,
  created_at TIMESTAMP DEFAULT NOW()
);
```

Store admin sessions in Redis keyed by `admin_session:<token>` with JSON payload { phone, expires_at } and TTL.

## Security considerations ⚠️
- Use TLS for the admin UI and API.
- Rate-limit `request-otp` attempts and lock after repeated failures.
- OTPs should be short-lived (e.g., 3–5 minutes) and single-use.
- Admin session TTL: short (e.g., 15 minutes) to reduce risk from stolen sessions.
- For very sensitive operations, require per-action OTP or a second factor.
- Consider IP allow-listing for admin accounts (configurable per account).

## Audit & Logging
- Insert a row into `admin_audit` for every admin action (who, ip, route, action, payload summary, success/failure).
- Log structured server log lines for suspicious patterns (excess OTP failures, many credits in short time).

## Manual QA
- Manual QA only: end-to-end flow with a staging phone number, verify OTP issuance and verification, admin session creation and expiry, protected admin endpoints access, and audit rows/ledger changes created.
- The operator will perform manual verification and sign-off; no automated unit or integration tests will be added at this time.

## Acceptance criteria ✅
- Only admin sessions issued by the OTP flow can access `/api/v1/admin/*` endpoints.
- `GET /admin/transactions` returns a paginated ledger view and supports filters; `GET /admin/stats` returns platform-level statistics; both actions are audited in `admin_audit`.
- All OTPs and admin sessions respect their TTLs and are single-use where intended.

## Implementation tasks (suggested order)
1. Migration: add `admin_accounts`, `admin_audit` (todo: create SQL file).  
2. Add DB models & helpers: load admin account, verify token (bcrypt), create admin_audit helper.  
3. Add `POST /admin/request-otp` and `POST /admin/verify-otp` endpoints. Reuse `RequestOTP`/`VerifyOTPAction` or add thin wrappers.  
4. Implement `AdminSessionMiddleware` (validate Redis admin_session token).  
5. Add minimal admin handlers for **transactions** and **platform stats** and wire in audit logging (handlers: `transactions`, `stats`).  
6. Add frontend `/pm-admin` page (phone+token → OTP flow → store session) and simple UI for accounts/transactions/stats.  
7. Manual QA and operator sign-off (no automated unit or integration tests will be added at this time).  

## Rollout & operational notes
- Add `ADMIN_TOKEN` entries and seed `admin_accounts` for initial operators (use hashed token).  
- Run migrations on staging, test thoroughly, then deploy to production with monitoring and alerting for admin audit anomalies.  

---

If this looks good I can: create the migration SQL files and Go models (next), or scaffold the admin endpoints and middleware first. Which should I start with? 🔧