import { redis } from '../config/redis';
import { pool } from '../config/db';
import type { RowDataPacket } from 'mysql2';

export interface Mailbox {
  id: number;
  user_id: number;
  email: string;
  daily_limit: number;
  hourly_limit: number;
}

export type LimitReason = 'daily' | 'hourly';
export type CheckResult =
  | { allowed: true }
  | { allowed: false; reason: LimitReason };

function dayKey(mailboxId: number, now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `rl:daily:${mailboxId}:${y}-${m}-${d}`;
}

function hourKey(mailboxId: number, now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  return `rl:hourly:${mailboxId}:${y}-${m}-${d}T${h}`;
}

export async function getMailbox(mailboxId: number): Promise<Mailbox | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id, user_id, email, daily_limit, hourly_limit FROM mailboxes WHERE id = ?',
    [mailboxId],
  );
  return (rows[0] as Mailbox) ?? null;
}

/**
 * Atomically check whether the mailbox can send another email right now, and
 * if so, increment the counter. Uses Redis MULTI/EXEC to prevent TOCTOU races
 * where two concurrent workers both read the same count and both pass the check.
 *
 * BUG FIXES applied:
 *  - Was using separate GET + INCR (race condition under concurrency)
 *  - Was using `>` instead of `>=` (allowed limit+1 sends)
 */
export async function checkAndIncrement(mailboxId: number): Promise<CheckResult> {
  const mailbox = await getMailbox(mailboxId);
  if (!mailbox) return { allowed: false, reason: 'daily' };

  const dKey = dayKey(mailboxId);
  const hKey = hourKey(mailboxId);

  // Atomic check-and-increment using MULTI/EXEC
  const pipeline = redis.multi();
  pipeline.incr(dKey);
  pipeline.incr(hKey);
  const results = await pipeline.exec();

  // results is [[error, value], [error, value]]
  if (!results) return { allowed: false, reason: 'daily' };

  const newDaily = results[0]![1] as number;
  const newHourly = results[1]![1] as number;

  // Set TTL on first creation (value === 1 means key was just created)
  if (newDaily === 1) await redis.expire(dKey, 86400);
  if (newHourly === 1) await redis.expire(hKey, 3600);

  // Check AFTER increment — if we exceeded the limit, roll back
  if (newDaily > mailbox.daily_limit) {
    await redis.decr(dKey);
    await redis.decr(hKey);
    return { allowed: false, reason: 'daily' };
  }
  if (newHourly > mailbox.hourly_limit) {
    await redis.decr(hKey);
    return { allowed: false, reason: 'hourly' };
  }

  return { allowed: true };
}

export interface QuotaSnapshot {
  mailboxId: number;
  email: string;
  daily: { used: number; limit: number };
  hourly: { used: number; limit: number };
}

export async function readQuota(mailboxId: number): Promise<QuotaSnapshot | null> {
  const mailbox = await getMailbox(mailboxId);
  if (!mailbox) return null;

  const dKey = dayKey(mailboxId);
  const hKey = hourKey(mailboxId);

  let dailyRaw = await redis.get(dKey);
  if (dailyRaw === null) {
    // Initialize the counter with a proper TTL so it doesn't persist forever.
    await redis.set(dKey, '0', 'EX', 86400);
    dailyRaw = '0';
  }
  let hourlyRaw = await redis.get(hKey);
  if (hourlyRaw === null) {
    await redis.set(hKey, '0', 'EX', 3600);
    hourlyRaw = '0';
  }

  return {
    mailboxId,
    email: mailbox.email,
    daily: { used: parseInt(dailyRaw, 10), limit: mailbox.daily_limit },
    hourly: { used: parseInt(hourlyRaw, 10), limit: mailbox.hourly_limit },
  };
}

/**
 * Approximate remaining budget for a mailbox in a given window. Used by the
 * resume code path to decide how many sends to schedule "today".
 */
export async function remainingBudget(mailboxId: number): Promise<{
  daily: number;
  hourly: number;
} | null> {
  const snapshot = await readQuota(mailboxId);
  if (!snapshot) return null;
  return {
    daily: Math.max(0, snapshot.daily.limit - snapshot.daily.used),
    hourly: Math.max(0, snapshot.hourly.limit - snapshot.hourly.used),
  };
}

// Export key generators for testing
export { dayKey as _dayKey, hourKey as _hourKey };
