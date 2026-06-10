# Findings

### 1. Off-by-one error in scheduleSequence loop
- **File / line:** `backend/src/sequences/scheduler.ts:42-44`
- **Severity:** Critical
- **What's wrong:** The loop `for (let i = 1; i <= steps.length; i++)` accesses `steps[i]`, but `steps` is a 0-indexed array. This skips the first step entirely (index 0) and crashes with `undefined` on the last iteration when `i === steps.length`.
- **Why it's a bug (when does it manifest?):** Every time a sequence is scheduled. Step 1 is always skipped, and the loop crashes trying to access `.delay_days` on `undefined` for the last index. In practice, this means scheduling never works correctly — it either errors out or silently skips the first email in every sequence.
- **Fix:** Changed to `for (let i = 0; i < steps.length; i++)`.
- **How I verified:** Code review of array indexing. After fix, scheduled emails are created for all steps including the first.

---

### 2. Race condition in rate limiter (TOCTOU)
- **File / line:** `backend/src/mailboxes/rateLimiter.ts:46-68`
- **Severity:** Critical
- **What's wrong:** The rate limiter performed a separate `GET` to read the counter, compared it against the limit, then called `INCR`. Under concurrent worker processing (concurrency=4), two workers could both read `dailyCount=99` (limit 100), both pass the check, and both increment — resulting in 101 sends, violating the limit.
- **Why it's a bug (when does it manifest?):** Whenever multiple worker threads process emails for the same mailbox simultaneously, which is the default behavior (worker concurrency=4).
- **Fix:** Replaced with `MULTI/EXEC` atomic pipeline: increment first, then check if exceeded. If exceeded, roll back with `DECR`. This eliminates the race window entirely.
- **How I verified:** Unit tests with mocked Redis verifying atomic operation. The test confirms `redis.multi()` is called instead of separate `redis.get()`.

---

### 3. Off-by-one in rate limit comparison
- **File / line:** `backend/src/mailboxes/rateLimiter.ts:58-59`
- **Severity:** High
- **What's wrong:** `if (dailyCount > mailbox.daily_limit)` uses `>` instead of `>=`. With a daily limit of 100, this allows 101 sends (0 through 100 inclusive). Same issue for the hourly check.
- **Why it's a bug (when does it manifest?):** Every time usage reaches the configured limit — one extra email always gets through.
- **Fix:** In the new atomic implementation, we increment first and check `if (newDaily > mailbox.daily_limit)` — since the counter now represents the *new* value after increment, `>` is correct (e.g., limit=100, 100th send → counter=100, allowed; 101st send → counter=101, rejected and rolled back).
- **How I verified:** Unit test: "should allow send at exactly the limit (limit=100, count becomes 100)" passes, confirming exactly 100 sends are allowed.

---

### 4. computeNextSendTime missing milliseconds multiplier
- **File / line:** `backend/src/sequences/service.ts:85`
- **Severity:** High
- **What's wrong:** `delayDays * 24 * 60 * 60` calculates seconds, but `Date.getTime()` returns milliseconds. So 1 delay_day would add 86400 *milliseconds* (86.4 seconds) instead of 86400 *seconds* (24 hours). Off by 1000x.
- **Why it's a bug (when does it manifest?):** Any code path that uses `computeNextSendTime` for resume scheduling. A "2 day delay" becomes a "2.88 minute delay".
- **Fix:** Changed to `delayDays * 24 * 60 * 60 * 1000`.
- **How I verified:** Code review. `1 * 24 * 60 * 60 * 1000 = 86400000` ms = 24 hours ✓.

---

### 5. Send log written before actual send
- **File / line:** `backend/src/worker/processor.ts:84-87`
- **Severity:** High
- **What's wrong:** A `send_logs` entry with status 'sent' is inserted *before* `send()` is called. The SMTP adapter has a 5% random failure rate. If `send()` throws, the audit trail falsely records a successful send.
- **Why it's a bug (when does it manifest?):** ~5% of all email sends result in a false 'sent' log entry when the email was never actually delivered. This corrupts reporting and makes debugging delivery failures impossible.
- **Fix:** Moved the `INSERT INTO send_logs` inside the `try` block, after `send()` completes successfully. Also added a failure log entry in the `catch` block.
- **How I verified:** Unit test "should send email successfully and log AFTER send" verifies call ordering: `smtp:send` occurs before `log:sent`. Test "should handle SMTP failure" verifies no `log:sent` entry exists on failure.

---

### 6. Worker ignores paused sequence status
- **File / line:** `backend/src/worker/processor.ts` (missing check) + `backend/src/sequences/routes.ts:87-95`
- **Severity:** Medium
- **What's wrong:** The pause handler removes BullMQ delayed jobs but doesn't handle in-flight jobs. A job that was already dequeued by the worker continues processing because the processor never checks `sequence_status`. The original code only checks `row.status !== 'pending'` — but the sequence-level status is ignored.
- **Why it's a bug (when does it manifest?):** When a user pauses a sequence while the worker is actively processing emails from it. The in-flight jobs complete and send emails even though the sequence is paused.
- **Fix:** Added `if (row.sequence_status === 'paused')` check early in `processSendJob` to skip and log 'sequence paused'.
- **How I verified:** Unit test "should respect paused sequence status" confirms the processor skips the send and logs appropriately.

---

### 7. cancelDelayedJobs limited to first 5000 jobs
- **File / line:** `backend/src/sequences/scheduler.ts:109`
- **Severity:** Medium
- **What's wrong:** `sendQueue.getDelayed(0, 5000)` only fetches the first 5000 delayed jobs. If a large sequence has more than 5000 pending delayed jobs, the remainder won't be cancelled on pause.
- **Why it's a bug (when does it manifest?):** Large sequences with many prospects × steps. E.g., 2000 prospects × 3 steps = 6000 scheduled emails.
- **Fix:** Added a loop that fetches in batches of 5000 until no more jobs are found.
- **How I verified:** Code review — the loop terminates when `jobs.length < batchSize` or `jobs.length === 0`.

---

### 8. IDOR vulnerability on scheduled-emails endpoint
- **File / line:** `backend/src/sequences/routes.ts:111-123`
- **Severity:** Medium
- **What's wrong:** The `GET /scheduled-emails/:id` endpoint uses `requireAuth` but doesn't verify that the authenticated user owns the scheduled email. Any logged-in user can fetch any scheduled email by guessing IDs.
- **Why it's a bug (when does it manifest?):** Always. An attacker with a valid account can enumerate all scheduled emails across all users.
- **Fix:** Added `JOIN sequences s ON s.id = se.sequence_id` with `WHERE s.user_id = ?` condition.
- **How I verified:** Code review of the updated SQL query — it now requires both the email ID and the user's ownership.

---

### 9. CORS allows all origins
- **File / line:** `backend/src/index.ts:9`
- **Severity:** Medium
- **What's wrong:** `app.use(cors())` allows requests from any origin, making the API vulnerable to cross-origin attacks. A malicious site could make authenticated requests on behalf of a logged-in user.
- **Why it's a bug (when does it manifest?):** In production. Less critical in dev but still a bad pattern.
- **Fix:** Restricted to `http://localhost:5173` (the frontend URL) with `credentials: true`.
- **How I verified:** Code review.

---

### 10. readQuota creates TTL-less Redis keys
- **File / line:** `backend/src/mailboxes/rateLimiter.ts:84-94`
- **Severity:** Low
- **What's wrong:** When `readQuota` initializes missing counters with `redis.set(dKey, 0)`, it doesn't set a TTL. Meanwhile, `checkAndIncrement` only sets TTL when `INCR` returns 1 (first creation). If `readQuota` creates the key first, the subsequent `INCR` won't return 1, so no TTL is set → the key persists forever, causing a slow memory leak.
- **Why it's a bug (when does it manifest?):** When the quota page is viewed before any emails are sent for that day/hour. Over time, stale counter keys accumulate in Redis.
- **Fix:** Changed to `redis.set(dKey, '0', 'EX', 86400)` and `redis.set(hKey, '0', 'EX', 3600)`.
- **How I verified:** Unit test "should initialize missing counters with 0 AND set TTL" verifies `redis.set` is called with `'EX'` and correct TTL values.
