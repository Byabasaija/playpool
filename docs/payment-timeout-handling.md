# Payment Timeout Handling

## Overview
This document describes how the system handles mobile money payment timeouts and edge cases.

## Timeout Scenarios & Handling

### Scenario 1: User Completes Payment Within 2 Minutes (Happy Path)
**Flow:**
1. Frontend initiates payment → backend returns `PENDING` status
2. Frontend shows "Complete payment on phone" screen
3. User approves payment on phone within 2 minutes
4. Webhook confirms payment → player added to matchmaking queue
5. Frontend detects player in queue → transitions to matching screen
6. **Result:** ✅ Everything works perfectly

---

### Scenario 2: Frontend Times Out, But User Completes Payment After
**Flow:**
1. Frontend waits 2 minutes (40 polls × 3 seconds)
2. Frontend timeout → shows error: "Payment timeout. If you completed the payment, refresh this page in a moment..."
3. User completes payment after timeout
4. Webhook processes successfully → player added to queue
5. **User Experience:** User sees error but is actually queued

**Resolution:**
- User can refresh the page to check queue status
- Error message guides them to refresh if payment was completed
- Backend handles late webhook correctly

---

### Scenario 3: User Never Completes Payment (Abandoned)
**Flow:**
1. Frontend times out after 2 minutes
2. User never approves payment on phone
3. Transaction stays `PENDING` in database
4. **Cleanup worker** marks transaction as `EXPIRED` after 10 minutes
5. **Result:** ✅ Database cleaned up automatically

**Implementation:**
```go
// Runs every 5 minutes, expires transactions older than 10 minutes
payment.StartCleanupWorker(context.Background(), db, 5, 10)
```

---

### Scenario 4: User Tries to Stake Again While PENDING Exists
**Flow:**
1. User initiates payment → transaction marked `PENDING`
2. User doesn't complete payment (or frontend times out)
3. User tries to stake again
4. **Backend check prevents duplicate:** Returns 409 Conflict
5. **Error message:** "You already have a pending payment. Please complete or wait for it to expire."

**Implementation:**
```go
// Check before creating new pending transaction
var existingPending int
db.Get(&existingPending, `SELECT COUNT(*) FROM transactions WHERE player_id=$1 AND status='PENDING'`, player.ID)
if existingPending > 0 {
    return 409 Conflict
}
```

---

### Scenario 5: Webhook Arrives After Cleanup (Very Rare)
**Flow:**
1. Transaction marked `PENDING`
2. User never completes payment
3. Cleanup worker marks transaction as `EXPIRED` after 10 minutes
4. Webhook arrives 15 minutes later (very delayed)
5. **Webhook idempotency check:** Transaction not in `PENDING` status
6. Webhook logs "already processed" and returns 200 OK
7. **Result:** ✅ No duplicate processing, no errors

---

## Configuration

### Frontend Timeout
- **Poll interval:** 3 seconds
- **Max attempts:** 40 (2 minutes total)
- **Location:** `frontend/src/hooks/useMatchmaking.ts:102`

### Backend Cleanup
- **Check interval:** 5 minutes
- **Expiry threshold:** 10 minutes
- **Location:** `cmd/server/main.go:76`

```go
go payment.StartCleanupWorker(context.Background(), db, 5, 10)
```

---

## Transaction Status Flow

```
PENDING
   ↓
   ├─→ COMPLETED (webhook success within timeout)
   ├─→ FAILED (webhook failure)
   └─→ EXPIRED (no webhook after 10 minutes)
```

---

## Testing Scenarios

### Test 1: Happy Path
1. Initiate stake
2. Complete payment within 30 seconds
3. ✅ Should see matching screen

### Test 2: Timeout Then Complete
1. Initiate stake
2. Wait 2 minutes (don't complete payment)
3. See error message
4. Complete payment on phone
5. Refresh page
6. ✅ Should see queue/game status

### Test 3: Complete Abandonment
1. Initiate stake
2. Don't complete payment
3. Wait 10 minutes
4. Check database: transaction should be `EXPIRED`
5. ✅ Can initiate new stake

### Test 4: Duplicate Prevention
1. Initiate stake (creates PENDING transaction)
2. Try to stake again immediately
3. ✅ Should get 409 error: "already have a pending payment"

---

## Monitoring & Logs

**Cleanup logs:**
```
[PAYMENT-CLEANUP] Marked 3 transactions as EXPIRED (older than 2026-01-30 10:00:00)
```

**Duplicate prevention logs:**
```
[PAYMENT] Player 123 already has a pending transaction
```

**Late webhook logs:**
```
[WEBHOOK] Transaction already processed: status=EXPIRED
```

---

## Potential Improvements (Future)

1. **Send SMS on timeout:** Notify user if payment is still pending after 10 minutes
2. **Admin dashboard alert:** Show transactions stuck in PENDING for manual review
3. **Retry button:** Allow user to check payment status manually from error screen
4. **Webhook retry:** DMarkPay might retry webhooks - ensure idempotency handles this
5. **Player notification:** When late payment completes, send push notification/SMS to return to game
