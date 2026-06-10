import { pool } from '../config/db';
import { Queue } from 'bullmq';
import { bullConnection } from '../config/redis';
import { getSteps, getProspects, setSequenceStatus, type Step } from './service';
import { remainingBudget } from '../mailboxes/rateLimiter';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const SEND_QUEUE = 'email-send';
export const sendQueue = new Queue(SEND_QUEUE, { connection: bullConnection });

interface ScheduleOpts {
  sequenceId: number;
  /** When to start scheduling from. Defaults to now. */
  from?: Date;
}

interface ScheduleResult {
  scheduled: number;
  skipped: number;
}

/**
 * Schedule a sequence: for each (prospect, step) pair, create a
 * `scheduled_emails` row and enqueue a delayed BullMQ job.
 *
 * BUG FIX: Original loop used `for (let i = 1; i <= steps.length; i++)`
 * and accessed `steps[i]` — this skipped the first step (index 0) and
 * crashed on the last iteration (steps[steps.length] === undefined).
 * Fixed to use standard 0-indexed loop.
 */
export async function scheduleSequence(opts: ScheduleOpts): Promise<ScheduleResult> {
  const { sequenceId, from = new Date() } = opts;

  const steps = await getSteps(sequenceId);
  const prospects = await getProspects(sequenceId);
  const mailboxId = await pickMailboxForSequence(sequenceId);

  let scheduled = 0;
  let skipped = 0;

  for (const prospect of prospects) {
    if (prospect.status !== 'active') {
      skipped++;
      continue;
    }

    for (let i = 0; i < steps.length; i++) {
      try {
        const step = steps[i];
        const delayMs = step.delay_days * 24 * 60 * 60 * 1000;
        const scheduledAt = new Date(from.getTime() + delayMs);

        const [result] = await pool.execute<ResultSetHeader>(
          `INSERT INTO scheduled_emails
             (sequence_id, step_id, prospect_id, mailbox_id, scheduled_at, status, attempts)
           VALUES (?, ?, ?, ?, ?, 'pending', 0)`,
          [sequenceId, step.id, prospect.id, mailboxId, scheduledAt],
        );

        const delay = Math.max(0, scheduledAt.getTime() - Date.now());
        await sendQueue.add(
          'send',
          { scheduledEmailId: result.insertId },
          { delay, jobId: `se-${result.insertId}` },
        );
        scheduled++;
      } catch (err) {
        console.error(
          `[scheduler] step skipped for prospect ${prospect.id} at index ${i}:`,
          (err as Error).message,
        );
        skipped++;
      }
    }
  }

  await setSequenceStatus(sequenceId, 'active');
  return { scheduled, skipped };
}

/**
 * Resume a paused sequence: pick remaining pending emails and re-enqueue
 * them spaced by the configured step delays from "now".
 *
 * Strategy:
 *  1. Fetch all pending scheduled_emails for this sequence, joined with step info
 *  2. Group them by prospect_id, ordered by step_order
 *  3. For each prospect's pending steps, compute new scheduled_at:
 *     - First pending step: NOW + step.delay_days
 *     - Subsequent steps: NOW + cumulative delay_days from first pending step
 *  4. Respect mailbox daily budget: don't schedule more emails today than remaining quota
 *  5. Overflow emails get pushed to next day(s)
 */
export async function resumeSequence(sequenceId: number): Promise<ScheduleResult> {
  const now = new Date();

  // Get pending scheduled emails with step details, ordered for grouping
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT se.id, se.prospect_id, se.mailbox_id, se.step_id,
            ss.delay_days, ss.step_order
       FROM scheduled_emails se
       JOIN sequence_steps ss ON ss.id = se.step_id
      WHERE se.sequence_id = ? AND se.status = 'pending'
      ORDER BY se.prospect_id ASC, ss.step_order ASC`,
    [sequenceId],
  );

  if (rows.length === 0) {
    return { scheduled: 0, skipped: 0 };
  }

  // Get mailbox budget (use the mailbox from the first email — they all share the same mailbox)
  const mailboxId = rows[0].mailbox_id as number;
  const budget = await remainingBudget(mailboxId);
  const dailyRemaining = budget?.daily ?? 0;

  // Group by prospect
  const byProspect = new Map<number, RowDataPacket[]>();
  for (const row of rows) {
    const pid = row.prospect_id as number;
    if (!byProspect.has(pid)) byProspect.set(pid, []);
    byProspect.get(pid)!.push(row);
  }

  let scheduled = 0;
  let skipped = 0;
  let todayBudgetUsed = 0;

  for (const [, prospectEmails] of byProspect) {
    // For each prospect, the first pending step starts from NOW + its delay_days.
    // Subsequent steps cascade from the first step's base time.
    const firstStepDelayDays = prospectEmails[0].delay_days as number;

    for (let i = 0; i < prospectEmails.length; i++) {
      const email = prospectEmails[i];
      const stepDelayDays = email.delay_days as number;

      // Calculate delay relative to now: offset from the first step's delay
      const relativeDays = stepDelayDays - firstStepDelayDays;
      let scheduledAt = new Date(now.getTime() + (firstStepDelayDays + relativeDays) * 24 * 60 * 60 * 1000);

      // Budget check: if this email would land today and we've exceeded daily budget,
      // push it to the next day
      const isToday = scheduledAt.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
      if (isToday && todayBudgetUsed >= dailyRemaining) {
        // Push to start of next day + some offset
        const tomorrow = new Date(now);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        tomorrow.setUTCHours(8, 0, 0, 0); // Schedule at 8 AM UTC next day
        scheduledAt = new Date(tomorrow.getTime() + (stepDelayDays - firstStepDelayDays) * 24 * 60 * 60 * 1000);
      } else if (isToday) {
        todayBudgetUsed++;
      }

      try {
        // Update the scheduled_at in the database
        await pool.execute(
          'UPDATE scheduled_emails SET scheduled_at = ? WHERE id = ?',
          [scheduledAt, email.id],
        );

        // Enqueue a new BullMQ delayed job
        const delay = Math.max(0, scheduledAt.getTime() - Date.now());
        await sendQueue.add(
          'send',
          { scheduledEmailId: email.id as number },
          { delay, jobId: `se-${email.id}` },
        );
        scheduled++;
      } catch (err) {
        console.error(
          `[scheduler] resume: failed to re-schedule email ${email.id}:`,
          (err as Error).message,
        );
        skipped++;
      }
    }
  }

  return { scheduled, skipped };
}

async function pickMailboxForSequence(sequenceId: number): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT m.id
       FROM sequences s
       JOIN mailboxes m ON m.user_id = s.user_id
      WHERE s.id = ?
      ORDER BY m.id ASC
      LIMIT 1`,
    [sequenceId],
  );
  if (rows.length === 0) {
    throw new Error('no mailbox available for sequence');
  }
  return rows[0].id as number;
}

export async function cancelDelayedJobs(sequenceId: number): Promise<number> {
  let cancelled = 0;
  let start = 0;
  const batchSize = 5000;

  // Loop to handle more than 5000 delayed jobs
  while (true) {
    const jobs = await sendQueue.getDelayed(start, start + batchSize - 1);
    if (jobs.length === 0) break;

    for (const job of jobs) {
      const seId = job.data?.scheduledEmailId as number | undefined;
      if (!seId) continue;
      const [rows] = await pool.execute<RowDataPacket[]>(
        'SELECT sequence_id FROM scheduled_emails WHERE id = ? LIMIT 1',
        [seId],
      );
      if (rows[0]?.sequence_id === sequenceId) {
        await job.remove();
        cancelled++;
      }
    }

    if (jobs.length < batchSize) break;
    start += batchSize;
  }

  return cancelled;
}

export function _typeBrand(): Step | undefined {
  return undefined;
}
