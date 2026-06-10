import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Sequence } from '../lib/types';

const STATUS_COLORS: Record<string, string> = {
  draft: 'badge-draft',
  active: 'badge-active',
  paused: 'badge-paused',
  completed: 'badge-completed',
};

export function SequencesPage() {
  const { data: sequences, isLoading, error } = useQuery<Sequence[]>({
    queryKey: ['sequences'],
    queryFn: () => api.get('/sequences'),
  });

  if (isLoading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading sequences...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-error">
        <p>Failed to load sequences: {(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Sequences</h2>
        <p className="page-subtitle">Manage your email sequences</p>
      </div>

      {!sequences || sequences.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">📭</span>
          <h3>No sequences yet</h3>
          <p>Create your first email sequence to get started.</p>
        </div>
      ) : (
        <div className="card-grid">
          {sequences.map((seq) => (
            <Link key={seq.id} to={`/sequences/${seq.id}`} className="sequence-card">
              <div className="sequence-card-header">
                <h3>{seq.name}</h3>
                <span className={`badge ${STATUS_COLORS[seq.status]}`}>
                  {seq.status}
                </span>
              </div>
              <div className="sequence-card-meta">
                <span>ID: {seq.id}</span>
                <span>Created: {new Date(seq.created_at).toLocaleDateString()}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
