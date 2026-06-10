# Decisions

## Pause / Resume

### Pause
- **In-flight jobs:** The worker now checks `sequence_status === 'paused'` at the start of processing each job. This means any job that was already dequeued from BullMQ but hasn't started actual SMTP delivery will be skipped. There's still a tiny window where a job could be mid-SMTP-send when pause is triggered — I chose not to add cancellation tokens for this because (a) SMTP sends take 100-300ms per the adapter, and (b) adding mid-send cancellation would add significant complexity with minimal benefit.
- **BullMQ delayed jobs:** `cancelDelayedJobs` removes them from the queue. I considered also updating the `scheduled_emails` status to 'paused', but decided against it since the resume logic needs them as 'pending' to know what to reschedule.
- **No-op behavior:** Pausing an already-paused sequence returns `{ ok: true, alreadyPaused: true }` without any state changes. This was already implemented in the original code.

### Resume
- **Time calculation:** When resuming, all pending scheduled_emails get new `scheduled_at` values based on NOW + their `delay_days`. The first pending step for each prospect fires at `NOW + delay_days`, and subsequent steps cascade from there. I chose to compute from NOW rather than from the original schedule because the assignment explicitly says "delay_days measured from now".
- **Budget enforcement:** Before scheduling emails for today, I check `remainingBudget()` for the mailbox. If today's budget is exhausted, remaining emails are pushed to the next day starting at 8 AM UTC. This is an approximation — the hourly budget isn't precisely modeled for future hours, but it prevents the obvious failure mode of queueing 500 sends on a mailbox with `daily_limit=100`.
- **Job ID conflicts:** BullMQ uses `jobId: se-${emailId}`. If a job was already removed (by pause), re-adding with the same ID works. If the old job somehow still exists, the add would fail — this is caught by the try/catch per email.

## Mailbox Quota UI

### Refresh strategy: Polling every 30 seconds
- **Why polling, not WebSocket:** The quota data changes only when the worker sends emails. This isn't a real-time chat scenario — polling every 30s is more than adequate for monitoring. WebSocket would add complexity (connection management, reconnection) for minimal benefit.
- **Why 30 seconds:** Aggressive enough to notice quota changes during active sending, but light enough not to overload the API. Each poll is a single Redis GET per mailbox — negligible load.
- **Staleness tolerance:** Up to 30s of stale data is acceptable for a monitoring dashboard. The visual ≥80% warning provides sufficient advance notice regardless of exact real-time accuracy.
- **TanStack Query:** Using `refetchInterval: 30000` gives us automatic background refetch, stale/fresh state management, and request deduplication for free.

## Test Framework

- **Vitest** — chosen because it's fast, TypeScript-native (no separate config), and provides built-in mocking via `vi.mock` and `vi.hoisted`. It integrates naturally with the existing Vite frontend toolchain.

## What I'd change with another day

1. **Database transactions:** The scheduler and processor should use MySQL transactions for atomic multi-step updates. Currently, if the process crashes between `UPDATE scheduled_emails SET status='processing'` and the actual send, the email gets stuck in 'processing' forever with no retry.
2. **Dead letter queue:** Failed emails are marked 'failed' but there's no retry mechanism or DLQ. BullMQ supports automatic retries, but the current setup doesn't configure them meaningfully.
3. **Optimistic locking:** The processor should use `UPDATE ... WHERE id = ? AND status = 'pending'` and check `affectedRows` before proceeding, to prevent double-sends if the same job runs twice.
4. **E2E integration tests:** The current tests mock all I/O. With more time, I'd add integration tests against a real test database and Redis instance.
5. **Better pause cleanup:** The pause handler should set `scheduled_emails.status = 'paused'` for cancelled jobs, so the UI can distinguish between "not yet sent" (pending) and "paused" states.

## Noticed but did not fix

- **No input sanitization in email body:** The sequence step body uses `{{name}}` placeholders but there's no templating engine or XSS sanitization. Not fixing because the "send" is a mock adapter anyway.
- **No pagination on sequences/prospects endpoints:** The endpoints return all records without pagination. Acceptable for an assignment but would need cursor-based pagination at scale.
- **Single mailbox per sequence:** `pickMailboxForSequence` always picks the first mailbox. Round-robin or load-balanced selection would be better but wasn't part of the assignment.
- **The `_typeBrand` function** in scheduler.ts — appears to be a type-forcing hack that keeps the `Step` type imported for downstream consumers. Harmless but unusual.
