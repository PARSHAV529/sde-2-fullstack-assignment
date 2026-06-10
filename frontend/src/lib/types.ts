export interface User {
  id: number;
  email: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Sequence {
  id: number;
  user_id: number;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  created_at: string;
}

export interface Step {
  id: number;
  sequence_id: number;
  step_order: number;
  delay_days: number;
  subject: string;
  body: string;
}

export interface Prospect {
  id: number;
  sequence_id: number;
  email: string;
  name: string | null;
  status: 'active' | 'unsubscribed' | 'bounced';
}

export interface ScheduledEmail {
  id: number;
  sequence_id: number;
  step_id: number;
  prospect_id: number;
  mailbox_id: number;
  scheduled_at: string;
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'skipped';
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
}

export interface SequenceDetail extends Sequence {
  steps: Step[];
  prospects: Prospect[];
}

export interface Mailbox {
  id: number;
  email: string;
  daily_limit: number;
  hourly_limit: number;
  created_at: string;
}

export interface QuotaSnapshot {
  mailboxId: number;
  email: string;
  daily: { used: number; limit: number };
  hourly: { used: number; limit: number };
}

export interface ScheduleResult {
  scheduled: number;
  skipped: number;
}
