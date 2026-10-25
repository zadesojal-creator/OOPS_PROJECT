import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, StatCard, Badge, Button, EmptyState } from '../components/Ui';
import { Icon } from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import { get, post, patch } from '../services/api';
import type { QueueToken } from '../types';

function formatWaitDuration(createdAt: string): string {
  if (!createdAt) return '—';
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const diffMins = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMins < 1) return 'Just now';
  if (diffMins === 1) return '1 min waiting';
  if (diffMins < 60) return `${diffMins} mins waiting`;
  const hrs = Math.floor(diffMins / 60);
  const remMins = diffMins % 60;
  return `${hrs}h ${remMins}m waiting`;
}

export default function Queue() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [waiting, setWaiting] = useState<QueueToken[]>([]);
  const [called, setCalled] = useState<QueueToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [callingId, setCallingId] = useState('');
  const [cancellingId, setCancellingId] = useState('');
  const [error, setError] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [doctorFilter, setDoctorFilter] = useState('ALL');

  const load = useCallback(async () => {
    try {
      const [nextWaiting, nextCalled] = await Promise.all([
        get<QueueToken[]>('/queue?status=WAITING'),
        get<QueueToken[]>('/queue?status=CALLED'),
      ]);
      setWaiting(nextWaiting);
      setCalled(nextCalled);
      setError('');
      setLastRefreshed(new Date());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to synchronize queue.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(interval);
  }, [load]);

  // Doctor or staff calling next patient
  async function callPatient(id: string) {
    setCallingId(id);
    setError('');
    try {
      await post(`/queue/${encodeURIComponent(id)}/call`);
      await load();
      navigate(`/consultations/${encodeURIComponent(id)}`);
    } catch (reason: any) {
      setError(reason instanceof Error ? reason.message : 'Unable to call patient.');
      await load();
    } finally {
      setCallingId('');
    }
  }

  // Doctor or staff calling the next highest-priority patient
  async function handleCallNext() {
    setCallingId('next');
    setError('');
    try {
      const res: any = await post('/queue/call-next');
      if (res && res.id) {
        await load();
        navigate(`/consultations/${encodeURIComponent(res.id)}`);
      } else if (filteredWaiting.length > 0) {
        await callPatient(filteredWaiting[0].id);
      }
    } catch (reason: any) {
      if (filteredWaiting.length > 0) {
        await callPatient(filteredWaiting[0].id);
      } else {
        setError(reason instanceof Error ? reason.message : 'No waiting patients in queue.');
        await load();
      }
    } finally {
      setCallingId('');
    }
  }

  // Cancel token
  async function cancelToken(item: QueueToken) {
    if (!confirm(`Are you sure you want to cancel token ${item.tokenNumber} for ${item.patientName}?`)) {
      return;
    }
    setCancellingId(item.id);
    setError('');
    try {
      await patch(`/queue/${encodeURIComponent(item.id)}/cancel`, {});
      await load();
    } catch (reason: any) {
      setError(reason instanceof Error ? reason.message : 'Failed to cancel queue token.');
    } finally {
      setCancellingId('');
    }
  }

  const canConsult = profile?.role === 'ADMIN' || profile?.role === 'DOCTOR';
  const canCancel = profile?.role === 'ADMIN' || profile?.role === 'RECEPTIONIST';

  // Extract unique doctors in queue
  const doctorsInQueue = Array.from(
    new Set(waiting.map((t) => t.doctorName).filter(Boolean)),
  );

  // Filtered waiting tokens
  const filteredWaiting = waiting.filter((t) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      t.patientName.toLowerCase().includes(q) ||
      t.tokenNumber.toLowerCase().includes(q) ||
      (t.patientPhone && t.patientPhone.includes(q)) ||
      (t.doctorName && t.doctorName.toLowerCase().includes(q));

    const matchesPriority =
      priorityFilter === 'ALL' || t.priority.toUpperCase() === priorityFilter.toUpperCase();

    const matchesDoctor =
      doctorFilter === 'ALL' || t.doctorName === doctorFilter;

    return matchesSearch && matchesPriority && matchesDoctor;
  });

  const emergencyCount = waiting.filter((t) => t.priority === 'EMERGENCY').length;
  const seniorCount = waiting.filter((t) => t.priority === 'SENIOR').length;

  return (
    <>
      {/* 1. Header Bar */}
      <div className="pagehead">
        <div>
          <div className="eyebrow">LIVE PATIENT TRIAGE</div>
          <h1>Queue Management</h1>
          <p>
            Deterministic priority routing: Emergency cases first, senior citizens (60+) next, followed by standard FIFO intake.
          </p>
        </div>

        <div className="pagehead-actions">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            title="Refresh current queue"
          >
            <Icon name="clock" size={15} />
            <span>Refreshed {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          </Button>

          {(profile?.role === 'ADMIN' || profile?.role === 'RECEPTIONIST') && (
            <Button variant="primary" onClick={() => navigate('/patients')}>
              <Icon name="plus" size={16} />
              <span>+ Intake Patient</span>
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="error page-error" role="alert">
          <span>{error}</span>
          <button className="link" onClick={() => void load()}>Retry</button>
        </div>
      )}

      {/* 2. KPI Metrics Grid */}
      <div className="stats-grid">
        <StatCard
          label="Waiting in Queue"
          value={waiting.length}
          subvalue="Awaiting consultation"
          icon="queue"
          tone="teal"
        />
        <StatCard
          label="In Consultation"
          value={called.length}
          subvalue="Currently with doctor"
          icon="user"
          tone="primary"
        />
        <StatCard
          label="Emergency Cases"
          value={emergencyCount}
          subvalue="Immediate top priority"
          icon="alert"
          tone="danger"
        />
        <StatCard
          label="Senior Citizens"
          value={seniorCount}
          subvalue="Priority intake (60+)"
          icon="users"
          tone="warning"
        />
      </div>

      {/* 3. In Consultation (Active) Banner */}
      {called.length > 0 && (
        <Card
          title={`Active Consultations (${called.length})`}
          subtitle="Patients currently inside physician cabins"
          className="mb-6"
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>
            {called.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: '16px',
                  background: 'var(--blue-50)',
                  border: '1.5px solid var(--blue-200)',
                  borderRadius: 'var(--radius-lg)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span className="token" style={{ background: '#fff', border: '1px solid var(--blue-300)' }}>
                      {item.tokenNumber}
                    </span>
                    <b style={{ fontSize: '15px', color: 'var(--blue-900)' }}>{item.patientName}</b>
                    <Badge tone={item.priority.toLowerCase()}>{item.priority}</Badge>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--slate-600)', marginTop: '4px' }}>
                    {item.doctorName ? `Dr. ${item.doctorName} · ` : ''}
                    {item.doctorRoom ? `${item.doctorRoom} · ` : ''}
                    Called {item.calledAt ? new Date(item.calledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'recently'}
                  </div>
                </div>

                <div>
                  {canConsult ? (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => navigate(`/consultations/${encodeURIComponent(item.id)}`)}
                    >
                      Consultation →
                    </Button>
                  ) : (
                    <Badge tone="teal">With Doctor</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 4. Filter & Search Controls */}
      <div className="filter-card">
        <div className="filter-grid" style={{ gridTemplateColumns: '1.5fr 1fr 1fr auto' }}>
          <div className="filter-item">
            <span className="filter-label">Search Patient / Token</span>
            <div className="filter-input-wrap">
              <input
                type="text"
                placeholder="Search by name, phone, or token (e.g. T-1)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="filter-item">
            <span className="filter-label">Filter by Priority</span>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
            >
              <option value="ALL">All Priorities</option>
              <option value="EMERGENCY">Emergency (High)</option>
              <option value="SENIOR">Senior Citizen (60+)</option>
              <option value="NORMAL">Normal Priority</option>
            </select>
          </div>

          <div className="filter-item">
            <span className="filter-label">Filter by Doctor</span>
            <select
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
            >
              <option value="ALL">All Doctors</option>
              {doctorsInQueue.map((doc) => (
                <option key={doc} value={doc}>
                  Dr. {doc}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-item" style={{ alignSelf: 'flex-end' }}>
            {(searchQuery || priorityFilter !== 'ALL' || doctorFilter !== 'ALL') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setPriorityFilter('ALL');
                  setDoctorFilter('ALL');
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 5. Waiting Queue Table */}
      <Card
        title={`Waiting Queue (${filteredWaiting.length})`}
        subtitle="Ordered by medical triage priority and arrival time"
        action={
          canConsult && filteredWaiting.length > 0 ? (
            <Button
              variant="primary"
              size="sm"
              disabled={callingId !== ''}
              onClick={() => void handleCallNext()}
              title="Call next patient in priority order"
            >
              <Icon name="check" size={14} />
              <span>{callingId === 'next' ? 'Calling…' : 'Call Next Patient'}</span>
            </Button>
          ) : undefined
        }
      >
        {loading ? (
          <div className="loading-panel">Loading queue data…</div>
        ) : filteredWaiting.length === 0 ? (
          <EmptyState
            icon="queue"
            title="No waiting patients"
            description={
              waiting.length === 0
                ? 'The patient queue is currently clear.'
                : 'No patients match the current filter criteria.'
            }
            action={
              (profile?.role === 'ADMIN' || profile?.role === 'RECEPTIONIST') ? (
                <Button variant="primary" size="sm" onClick={() => navigate('/patients')}>
                  + Intake Patient
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="modern-table-container">
            <table className="modern-table">
              <thead>
                <tr>
                  <th style={{ width: '80px' }}>Order</th>
                  <th style={{ width: '100px' }}>Token</th>
                  <th>Patient Details</th>
                  <th>Consulting Doctor</th>
                  <th>Priority</th>
                  <th>Waiting Time</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredWaiting.map((item, index) => {
                  const isNext = index === 0;
                  return (
                    <tr key={item.id} style={{ background: isNext ? 'var(--teal-50)' : undefined }}>
                      <td>
                        {isNext ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 8px',
                              background: 'var(--teal-600)',
                              color: '#fff',
                              borderRadius: 'var(--radius-full)',
                              fontSize: '11px',
                              fontWeight: 700,
                            }}
                          >
                            #1 Next
                          </span>
                        ) : (
                          <span style={{ fontWeight: 600, color: 'var(--slate-500)', fontSize: '13px' }}>
                            #{index + 1}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="token">{item.tokenNumber}</span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 700, color: 'var(--slate-900)' }}>
                          {item.patientName}
                        </div>
                        <div style={{ fontSize: '11.5px', color: 'var(--slate-500)' }}>
                          {item.patientAge ? `${item.patientAge} yrs • ` : ''}
                          {item.patientGender ? `${item.patientGender} • ` : ''}
                          {item.patientPhone || '—'}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--slate-800)' }}>
                          {item.doctorName ? `Dr. ${item.doctorName}` : 'General Triage'}
                        </div>
                        <div style={{ fontSize: '11.5px', color: 'var(--slate-500)' }}>
                          {item.doctorSpecialization || 'Physician'}
                          {item.doctorRoom ? ` · ${item.doctorRoom}` : ''}
                        </div>
                      </td>
                      <td>
                        <Badge tone={item.priority.toLowerCase()}>{item.priority}</Badge>
                      </td>
                      <td>
                        <div style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--slate-700)' }}>
                          {formatWaitDuration(item.createdAt)}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--slate-400)' }}>
                          {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                          {canConsult && (
                            <Button
                              variant={isNext ? 'primary' : 'secondary'}
                              size="sm"
                              disabled={callingId !== ''}
                              onClick={() => void callPatient(item.id)}
                              title={isNext ? 'Call next patient into consultation' : 'Call this patient directly'}
                            >
                              {callingId === item.id ? 'Calling…' : 'Call Next'}
                            </Button>
                          )}

                          {canCancel && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={cancellingId === item.id}
                              onClick={() => void cancelToken(item)}
                              title="Cancel patient queue entry"
                            >
                              <Icon name="x" size={14} />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
