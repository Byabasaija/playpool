# Phone OTP Auth & Withdraw MVP

Goal
- Add optional phone + OTP authentication and a minimal withdraw flow (placeholders for Mobile Money payouts). Keep guest staking unchanged so casual users are not blocked.

High-level design
- OTP-based auth: request OTP → verify OTP → return auth token. Tokens protect profile and withdraw endpoints.
- Withdraw: authenticated endpoint to request payouts; for now use a mock processor (placeholder) that completes requests when `MOCK_MODE=true`.

API surface

1) OTP: request + verify
- POST /api/v1/auth/request-otp
  - body: { phone: string }
  - behavior: rate-limited; generate short numeric OTP, store hashed OTP in Redis with TTL; enqueue async SMS send (DMark client).
  - response: { sms_queued: boolean }

- POST /api/v1/auth/verify-otp
  - body: { phone: string, code: string }
  - behavior: verify OTP from Redis; on success create JWT (signed) with short TTL or an opaque session token; return token and player info.
  - response: { token: string, player: { id, phone_number, display_name } }

2) Profile
- GET /api/v1/me
  - auth: Bearer token required
  - response: { display_name, avatar_url?, fee_exempt_balance, total_games_played, total_games_won, total_winnings }

- PUT /api/v1/me
  - body: { display_name?, avatar_url?, bio? }
  - auth required. Validate and persist.

3) Withdraw
- POST /api/v1/me/withdraw
  - auth required
  - body: { amount: number, method: 'MOMO'|'BANK', destination: string }
  - behavior: validate amount <= fee_exempt_balance; insert `withdraw_requests` row with status=PENDING and related transaction row; if `MOCK_MODE` then process immediately with simulated success; otherwise enqueue background payout worker.
  - response: { request_id, status }

- GET /api/v1/me/withdraws
  - auth required
  - returns list of withdraw requests for the player

Database changes (minimal)
- create `withdraw_requests` table:
  - id SERIAL PRIMARY KEY
  - player_id INT NOT NULL (FK players.id)
  - amount NUMERIC NOT NULL
  - method TEXT NOT NULL
  - destination TEXT NOT NULL
  - provider_txn_id TEXT NULL
  - status TEXT NOT NULL DEFAULT 'PENDING' -- ('PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED')
  - created_at TIMESTAMP DEFAULT NOW()
  - processed_at TIMESTAMP NULL
  - note TEXT NULL

- (No change to `players` table needed for MVP)

Backend implementation notes
- OTP storage: Redis key `otp:{phone}` store hashed OTP, use SETNX for rate-limit `otp_rate:{phone}`.
- Auth: issue short-lived JWT (ex: 24h) or opaque sessions; add `AuthMiddleware` to validate token and load player id.
- Withdraw processing: add a processor function with a clear interface so real MOM integration can be plumbed later. In `MOCK_MODE=true` the processor will mark withdraw as COMPLETED and perform internal account transfers.
- Ledger: use existing `accounts.Transfer` and `transactions` model to debit player fee-exempt account and record withdraw entries.

Frontend (MVP)
- Login modal/page:
  - Enter phone → request OTP (call POST /auth/request-otp)
  - Enter OTP → verify (POST /auth/verify-otp), store token in localStorage
- Profile page (protected): show balances and Withdraw UI.
- Withdraw UI: amount input, destination, confirm button. Call POST /me/withdraw and show status.
- Keep guest staking: if user is not authenticated allow guest stake flow; profile UI optional.

Configuration (env)
- OTP_TTL_SECONDS (e.g., 300)
- OTP_RATE_LIMIT_SECONDS (e.g., 60)
- JWT_SECRET
- MOCK_MODE=true/false
- MIN_WITHDRAW_AMOUNT, WITHDRAW_FEE_PERCENT

Security & operational considerations
- Rate-limit OTP requests and verification attempts per phone.
- Hash OTPs in Redis (do not store codes in plaintext).
- Audit withdraw requests and require server-side balance checks.
- Mock payout processor must be clearly flagged to avoid accidental real payouts in staging.

Work breakdown (MVP)
1. OTP endpoints, Redis OTP storage, DMark send hook (request + verify). Configure rate-limits. (Backend)
2. Auth middleware + token issuance. (Backend)
3. Withdraw schema (`withdraw_requests`) and POST /me/withdraw + mock processor that uses `accounts.Transfer` to mark initiator. (Backend)
4. Simple frontend login modal + profile & withdraw UI. Keep guest staking unchanged. (Frontend)
5. Docs: API docs and `.env` additions.

Next step
- If you approve, I will draft the SQL migration and the handler signatures for the OTP and withdraw endpoints so we can review before implementation.
