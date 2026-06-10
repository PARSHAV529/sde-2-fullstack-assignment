import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { SequenceDetail, ScheduledEmail } from '../lib/types';

const STATUS_ICONS: Record<string, string> = {
  pending: '🕐',
  processing: '⚡',
  sent: '✅',
  failed: '❌',
  skipped: '⏭️',
};

export function SequenceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: sequence, isLoading, error } = useQuery<SequenceDetail>({
    queryKey: ['sequence', id],
    queryFn: () => api.get(`/sequences/${id}`),
  });

  const { data: scheduledEmails, isLoading: emailsLoading } = useQuery<ScheduledEmail[]>({
    queryKey: ['scheduled-emails', id],
    queryFn: () => api.get(`/sequences/${id}/scheduled-emails`),
    refetchInterval: 5000, // Poll every 5s to see worker progress
  });

  const scheduleMutation = useMutation({
    mutationFn: () => api.post(`/sequences/${id}/schedule`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sequence', id] });
      queryClient.invalidateQueries({ queryKey: ['scheduled-emails', id] });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: () => api.post(`/sequences/${id}/pause`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sequence', id] });
      queryClient.invalidateQueries({ queryKey: ['scheduled-emails', id] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: () => api.post(`/sequences/${id}/resume`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sequence', id] });
      queryClient.invalidateQueries({ queryKey: ['scheduled-emails', id] });
    },
  });

  if (isLoading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading sequence...</p>
      </div>
    );
  }

  if (error || !sequence) {
    return (
      <div className="page-error">
        <p>Failed to load sequence</p>
        <button className="btn btn-secondary" onClick={() => navigate('/')}>
          Back to Sequences
        </button>
      </div>
    );
  }

  const statusBadgeClass = `badge badge-${sequence.status}`;
  const isActive = sequence.status === 'active';
  const isPaused = sequence.status === 'paused';
  const isDraft = sequence.status === 'draft';

  return (
    <div className="page">
      <div className="page-header">
        <button className="btn-back" onClick={() => navigate('/')}>
          ← Back
        </button>
        <div className="page-title-row">
          <h2>{sequence.name}</h2>
          <span className={statusBadgeClass}>{sequence.status}</span>
        </div>
        <div className="action-buttons">
          {isDraft && (
            <button
              className="btn btn-primary"
              onClick={() => scheduleMutation.mutate()}
              disabled={scheduleMutation.isPending}
            >
              {scheduleMutation.isPending ? 'Scheduling...' : '🚀 Schedule'}
            </button>
          )}
          {isActive && (
            <button
              className="btn btn-warning"
              onClick={() => pauseMutation.mutate()}
              disabled={pauseMutation.isPending}
            >
              {pauseMutation.isPending ? 'Pausing...' : '⏸ Pause'}
            </button>
          )}
          {isPaused && (
            <button
              className="btn btn-success"
              onClick={() => resumeMutation.mutate()}
              disabled={resumeMutation.isPending}
            >
              {resumeMutation.isPending ? 'Resuming...' : '▶ Resume'}
            </button>
          )}
        </div>
      </div>

      {/* Steps section */}
      <section className="detail-section">
        <h3>Steps ({sequence.steps.length})</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Subject</th>
                <th>Delay</th>
              </tr>
            </thead>
            <tbody>
              {sequence.steps.map((step) => (
                <tr key={step.id}>
                  <td>{step.step_order}</td>
                  <td>{step.subject}</td>
                  <td>{step.delay_days === 0 ? 'Immediately' : `${step.delay_days} day(s)`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Prospects section */}
      <section className="detail-section">
        <h3>Prospects ({sequence.prospects.length})</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sequence.prospects.map((prospect) => (
                <tr key={prospect.id}>
                  <td>{prospect.email}</td>
                  <td>{prospect.name || '—'}</td>
                  <td>
                    <span className={`badge badge-${prospect.status === 'active' ? 'active' : 'paused'}`}>
                      {prospect.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Scheduled Emails section */}
      <section className="detail-section">
        <h3>Scheduled Emails {scheduledEmails ? `(${scheduledEmails.length})` : ''}</h3>
        {emailsLoading ? (
          <div className="inline-loading"><div className="spinner spinner-sm" /> Loading...</div>
        ) : !scheduledEmails || scheduledEmails.length === 0 ? (
          <p className="text-muted">No scheduled emails yet. Schedule the sequence first.</p>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Step</th>
                  <th>Prospect</th>
                  <th>Scheduled At</th>
                  <th>Sent At</th>
                  <th>Attempts</th>
                </tr>
              </thead>
              <tbody>
                {scheduledEmails.map((email) => (
                  <tr key={email.id} className={`row-${email.status}`}>
                    <td>{email.id}</td>
                    <td>
                      <span className="status-cell">
                        {STATUS_ICONS[email.status] || '❓'} {email.status}
                      </span>
                    </td>
                    <td>{email.step_id}</td>
                    <td>{email.prospect_id}</td>
                    <td>{new Date(email.scheduled_at).toLocaleString()}</td>
                    <td>{email.sent_at ? new Date(email.sent_at).toLocaleString() : '—'}</td>
                    <td>{email.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
