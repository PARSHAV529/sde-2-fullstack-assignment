import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Mailbox, QuotaSnapshot } from '../lib/types';

function QuotaBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const isWarning = pct >= 80;
  const isCritical = pct >= 95;

  return (
    <div className="quota-bar-container">
      <div className="quota-bar-header">
        <span className="quota-label">{label}</span>
        <span className={`quota-value ${isWarning ? 'warning' : ''} ${isCritical ? 'critical' : ''}`}>
          {used} / {limit}
        </span>
      </div>
      <div className="quota-bar-track">
        <div
          className={`quota-bar-fill ${isWarning ? 'warning' : ''} ${isCritical ? 'critical' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {isWarning && (
        <span className={`quota-alert ${isCritical ? 'critical' : 'warning'}`}>
          {isCritical ? '🔴 At limit!' : '⚠️ Approaching limit'}
        </span>
      )}
    </div>
  );
}

function MailboxQuotaCard({ mailbox }: { mailbox: Mailbox }) {
  const { data: quota, isLoading, error } = useQuery<QuotaSnapshot>({
    queryKey: ['mailbox-quota', mailbox.id],
    queryFn: () => api.get(`/mailboxes/${mailbox.id}/quota`),
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  return (
    <div className="quota-card">
      <div className="quota-card-header">
        <span className="quota-email">📧 {mailbox.email}</span>
      </div>
      {isLoading ? (
        <div className="inline-loading"><div className="spinner spinner-sm" /> Loading quota...</div>
      ) : error ? (
        <div className="quota-error">Failed to load quota</div>
      ) : quota ? (
        <div className="quota-card-body">
          <QuotaBar used={quota.daily.used} limit={quota.daily.limit} label="Daily" />
          <QuotaBar used={quota.hourly.used} limit={quota.hourly.limit} label="Hourly" />
        </div>
      ) : null}
    </div>
  );
}

export function MailboxQuotaPage() {
  const { data: mailboxes, isLoading, error } = useQuery<Mailbox[]>({
    queryKey: ['mailboxes'],
    queryFn: () => api.get('/mailboxes'),
  });

  if (isLoading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading mailboxes...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-error">
        <p>Failed to load mailboxes: {(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Mailbox Quota</h2>
        <p className="page-subtitle">
          Monitor sending limits across your mailboxes
          <span className="refresh-hint"> • Auto-refreshes every 30s</span>
        </p>
      </div>

      {!mailboxes || mailboxes.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">📮</span>
          <h3>No mailboxes</h3>
          <p>No mailboxes configured for your account.</p>
        </div>
      ) : (
        <div className="quota-grid">
          {mailboxes.map((mb) => (
            <MailboxQuotaCard key={mb.id} mailbox={mb} />
          ))}
        </div>
      )}
    </div>
  );
}
