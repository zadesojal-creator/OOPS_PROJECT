import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, StatCard, Badge, Button, EmptyState, Modal } from '../components/Ui';
import { Icon } from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import { get, post } from '../services/api';
import PatientDashboard from './PatientDashboard';
import type {
  DashboardStats,
  QueueToken,
  DoctorWiseItem,
  Appointment,
} from '../types';

function formatWorkingDays(days?: number[]): string {
  if (!days || days.length === 0) return 'Monday – Saturday';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days.map((d) => names[d] || d).join(', ');
}

export default function Dashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  // If patient, render personalized PatientDashboard
  if (profile?.role === 'PATIENT') {
    return <PatientDashboard />;
  }

  // Common stats & live data
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [queue, setQueue] = useState<QueueToken[]>([]);
  const [todayAppointments, setTodayAppointments] = useState<Appointment[]>([]);
  const [doctorsList, setDoctorsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checkingInId, setCheckingInId] = useState<string | null>(null);

  // Microservices System Health
  const [systemHealth, setSystemHealth] = useState<{ telegram: boolean; rag: boolean; node: boolean }>({
    telegram: true,
    rag: true,
    node: true,
  });

  // Add User Modal State for Admin
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<'DOCTOR' | 'RECEPTIONIST' | 'ADMIN'>('DOCTOR');
  const [newUserSpecialization, setNewUserSpecialization] = useState('General Medicine');
  const [newUserRoom, setNewUserRoom] = useState('Cabin 101');
  const [newUserFee, setNewUserFee] = useState('$40');
  const [showPassword, setShowPassword] = useState(false);
  const [userCreateSubmitting, setUserCreateSubmitting] = useState(false);
  const [userCreateError, setUserCreateError] = useState('');
  const [userCreateSuccess, setUserCreateSuccess] = useState('');

  // Admin Doctor-Wise Patient Management state
  const [doctorWiseData, setDoctorWiseData] = useState<DoctorWiseItem[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [patientSearch, setPatientSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Doctor personalized dashboard state
  const [doctorSummary, setDoctorSummary] = useState<any>(null);
  const [togglingDuty, setTogglingDuty] = useState(false);
  const [callingTokenId, setCallingTokenId] = useState<string | null>(null);
  const [callingNext, setCallingNext] = useState(false);

  const load = useCallback(async () => {
    setError('');
    const today = new Date().toISOString().split('T')[0];
    try {
      const promises: Promise<any>[] = [
        get<DashboardStats>('/dashboard/stats'),
        get<QueueToken[]>('/queue?status=WAITING'),
      ];

      if (profile?.role === 'RECEPTIONIST' || profile?.role === 'ADMIN') {
        promises.push(get<Appointment[]>(`/appointments?date=${today}`));
        promises.push(get<any[]>('/doctors'));
        promises.push(get<{ telegram: boolean; rag: boolean; node: boolean }>('/health/system').catch(() => ({
          telegram: true,
          rag: true,
          node: true,
        })));
      }

      if (profile?.role === 'ADMIN') {
        promises.push(get<{ doctors: DoctorWiseItem[] }>('/dashboard/doctor-wise'));
      } else if (profile?.role === 'DOCTOR') {
        promises.push(get<any>('/dashboard/doctor-summary'));
      }

      const results = await Promise.all(promises);
      setStats(results[0]);
      setQueue(results[1].slice(0, 8));

      let resultIdx = 2;
      if (profile?.role === 'RECEPTIONIST' || profile?.role === 'ADMIN') {
        setTodayAppointments(results[resultIdx] || []);
        resultIdx++;
        setDoctorsList(results[resultIdx] || []);
        resultIdx++;
        if (results[resultIdx]) {
          setSystemHealth(results[resultIdx]);
        }
        resultIdx++;
      }

      if (profile?.role === 'ADMIN') {
        const extraData = results[resultIdx];
        if (extraData?.doctors) {
          setDoctorWiseData(extraData.doctors);
          if (extraData.doctors.length > 0 && !selectedDoctorId) {
            setSelectedDoctorId(extraData.doctors[0].id);
          }
        }
      } else if (profile?.role === 'DOCTOR') {
        setDoctorSummary(results[resultIdx]);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to load dashboard information.',
      );
    } finally {
      setLoading(false);
    }
  }, [profile?.role, selectedDoctorId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Doctor: Toggle On-Duty status
  async function toggleDuty(currentStatus: boolean) {
    setTogglingDuty(true);
    try {
      await post('/me/availability', { onDuty: !currentStatus });
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to update duty status.');
    } finally {
      setTogglingDuty(false);
    }
  }

  // Doctor: Call next patient from queue
  async function callPatient(token: QueueToken) {
    setCallingTokenId(token.id);
    setError('');
    try {
      await post(`/queue/${token.id}/call`);
      navigate(`/consultations/${token.id}`);
    } catch (err: any) {
      setError(err.message || 'Unable to call patient.');
      await load();
    } finally {
      setCallingTokenId(null);
    }
  }

  // Doctor: Call next patient via priority engine
  async function handleCallNextPatient() {
    setCallingNext(true);
    setError('');
    try {
      const res: any = await post('/queue/call-next');
      if (res && res.id) {
        navigate(`/consultations/${res.id}`);
      } else if (doctorSummary?.waitingTokens?.length > 0) {
        await callPatient(doctorSummary.waitingTokens[0]);
      }
    } catch (err: any) {
      if (doctorSummary?.waitingTokens?.length > 0) {
        await callPatient(doctorSummary.waitingTokens[0]);
      } else {
        setError(err.message || 'No waiting patients in queue.');
        await load();
      }
    } finally {
      setCallingNext(false);
    }
  }

  // Receptionist / Admin: Quick Check-in for today's appointment
  async function quickCheckIn(apt: Appointment) {
    setCheckingInId(apt.id);
    setError('');
    try {
      await post(`/appointments/${apt.id}/checkin`, {});
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to check in appointment.');
    } finally {
      setCheckingInId(null);
    }
  }

  // Admin: Create new user shortcut
  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setUserCreateError('');
    setUserCreateSuccess('');

    if (!newUserName.trim()) {
      setUserCreateError('Full name is required.');
      return;
    }
    if (!newUserEmail.trim() || !newUserEmail.includes('@')) {
      setUserCreateError('Please enter a valid email address.');
      return;
    }
    if (!newUserPassword || newUserPassword.length < 6) {
      setUserCreateError('Password must be at least 6 characters long.');
      return;
    }

    setUserCreateSubmitting(true);
    try {
      const payload: any = {
        name: newUserName.trim(),
        email: newUserEmail.trim(),
        password: newUserPassword,
        role: newUserRole,
        active: true,
      };

      if (newUserRole === 'DOCTOR') {
        payload.specialization = newUserSpecialization.trim() || 'General Medicine';
        payload.room = newUserRoom.trim() || 'Cabin 101';
        payload.fee = newUserFee.trim() || '$40';
      }

      await post('/admin/users', payload);
      setUserCreateSuccess(`User ${newUserName} successfully created as ${newUserRole}.`);
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPassword('');
      await load();
      setTimeout(() => {
        setShowAddUserModal(false);
        setUserCreateSuccess('');
      }, 1400);
    } catch (err: any) {
      setUserCreateError(err.message || 'Failed to create user. Please check server logs.');
    } finally {
      setUserCreateSubmitting(false);
    }
  }

  const selectedDoctor = doctorWiseData.find((d) => d.id === selectedDoctorId);

  // Filter associated patients for selected doctor
  const filteredPatients = (selectedDoctor?.patients || []).filter((p) => {
    const matchesSearch =
      !patientSearch ||
      p.name.toLowerCase().includes(patientSearch.toLowerCase()) ||
      p.phone.includes(patientSearch);
    const matchesStatus =
      statusFilter === 'ALL' ||
      p.recentStatus.toUpperCase() === statusFilter.toUpperCase();
    return matchesSearch && matchesStatus;
  });

  const formattedDate = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).toUpperCase();

  return (
    <>
      {/* 1. Header Bar */}
      <div className="pagehead">
        <div>
          <div className="eyebrow">
            {profile?.role === 'ADMIN' ? `System > ${profile?.name || 'Administrator'}` : formattedDate}
          </div>
          <h1>Welcome, {profile?.name || 'Clinic Team'}</h1>
          <p>
            {profile?.role === 'ADMIN'
              ? 'This is the control center for clinic operations: queues, appointments, staff, and system health.'
              : profile?.role === 'DOCTOR'
              ? 'Today’s consultations, duty schedule, and active patient queue.'
              : 'Front-desk patient intake, doctor selection, and schedule overview.'}
          </p>
        </div>

        <div className="pagehead-actions">
          {profile?.role === 'DOCTOR' && doctorSummary?.doctor && (
            <Button
              variant={doctorSummary.doctor.onDuty ? 'primary' : 'secondary'}
              disabled={togglingDuty}
              onClick={() => void toggleDuty(doctorSummary.doctor.onDuty)}
            >
              <Icon name="check" size={16} />
              <span>
                {togglingDuty
                  ? 'Updating…'
                  : doctorSummary.doctor.onDuty
                  ? 'On Duty (Active)'
                  : 'Off Duty'}
              </span>
            </Button>
          )}

          {(profile?.role === 'ADMIN' || profile?.role === 'RECEPTIONIST') && (
            <>
              <Button variant="primary" onClick={() => navigate('/patients')}>
                <Icon name="plus" size={16} />
                <span>+ Intake Patient</span>
              </Button>
              <Button variant="outline" onClick={() => navigate('/appointments')}>
                <Icon name="calendar" size={16} />
                <span>Schedule Appointment</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="error page-error" role="alert">
          <span>{error}</span>
          <button className="link" onClick={() => void load()}>Retry</button>
        </div>
      )}

      {loading ? (
        <div className="loading-panel">
          <div className="skeleton-box" style={{ width: '40%', height: '24px', margin: '0 auto 12px' }} />
          <span>Synchronizing live clinic operations…</span>
        </div>
      ) : (
        <>
          {/* Doctor Profile Configuration Error Banner */}
          {profile?.role === 'DOCTOR' && !doctorSummary?.doctor && (
            <div
              className="card"
              style={{
                border: '2px solid var(--rose-400)',
                background: 'var(--rose-50)',
                padding: '24px',
                borderRadius: 'var(--radius-lg)',
                marginBottom: '20px',
              }}
            >
              <h3 style={{ color: 'var(--rose-700)', margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name="alert" size={20} /> Doctor Profile Configuration Error
              </h3>
              <p style={{ color: 'var(--rose-900)', margin: '0 0 12px 0', fontSize: '13.5px' }}>
                {error || 'Unable to resolve your physician profile from the clinic database. Your user account is not linked to an active doctor record.'}
              </p>
              <div style={{ color: 'var(--rose-800)', fontSize: '12px' }}>
                Logged-in UID: <code>{profile?.uid}</code> · Role: <code>{profile?.role}</code>
              </div>
            </div>
          )}

          {/* 2. KPI Stat Cards ("The Pulse" of the Clinic) */}
          <div className="stats-grid">
            {profile?.role === 'DOCTOR' && doctorSummary ? (
              <>
                <StatCard
                  label="My Waiting Queue"
                  value={doctorSummary.waitingTokens?.length || 0}
                  subvalue="Patients awaiting intake"
                  icon="queue"
                  tone="teal"
                  loading={loading}
                  onClick={() => navigate('/queue')}
                />
                <StatCard
                  label="Completed Today"
                  value={doctorSummary.completedTodayCount || 0}
                  subvalue="Finished consultations"
                  icon="check"
                  tone="success"
                  loading={loading}
                />
                <StatCard
                  label="Emergency Cases"
                  value={doctorSummary.emergencyCount || 0}
                  subvalue="High priority triage"
                  icon="alert"
                  tone="danger"
                  loading={loading}
                />
                <StatCard
                  label="Senior Patients"
                  value={doctorSummary.seniorCount || 0}
                  subvalue="Age 60+ priority intake"
                  icon="users"
                  tone="warning"
                  loading={loading}
                />
              </>
            ) : (
              <>
                <StatCard
                  label="Waiting Patients"
                  value={stats?.waiting ?? queue.length}
                  subvalue="Total in live queue"
                  icon="queue"
                  tone="teal"
                  loading={loading}
                  onClick={() => navigate('/queue')}
                />
                <StatCard
                  label="Completed Visits"
                  value={stats?.completed ?? 0}
                  subvalue="Patients treated today"
                  icon="check"
                  tone="success"
                  loading={loading}
                />
                <StatCard
                  label="Emergency Cases"
                  value={stats?.emergency ?? 0}
                  subvalue="Urgent triage attention"
                  icon="alert"
                  tone="danger"
                  loading={loading}
                />
                <StatCard
                  label="Doctors On Duty"
                  value={stats?.doctorsAvailable ?? doctorsList.filter((d) => d.onDuty).length}
                  subvalue="Currently marked Available"
                  icon="users"
                  tone="purple"
                  loading={loading}
                />
              </>
            )}
          </div>

          {/* 3. DOCTOR WORKSPACE */}
          {profile?.role === 'DOCTOR' && doctorSummary?.doctor && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Active Consultation Alert Banner */}
              {doctorSummary.activeConsultation && (
                <div
                  style={{
                    background: 'var(--blue-50)',
                    border: '1.5px solid var(--blue-300)',
                    padding: '16px 20px',
                    borderRadius: 'var(--radius-lg)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <div>
                    <Badge tone="emergency">ACTIVE IN CONSULTATION</Badge>
                    <div style={{ fontSize: '18px', fontWeight: 800, marginTop: '4px', color: 'var(--blue-900)' }}>
                      Token {doctorSummary.activeConsultation.tokenNumber} · {doctorSummary.activeConsultation.patientName}
                    </div>
                    <small style={{ color: 'var(--slate-600)' }}>
                      Priority: {doctorSummary.activeConsultation.priority}
                    </small>
                  </div>
                  <Button variant="primary" onClick={() => navigate(`/consultations/${doctorSummary.activeConsultation.id}`)}>
                    Resume Consultation →
                  </Button>
                </div>
              )}

              {/* Physician Profile & Duty Card */}
              <Card title="Physician Profile & Duty Schedule">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }}>
                  <div style={{ borderRight: '1px solid var(--color-border)', paddingRight: '20px' }}>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--slate-900)' }}>
                      {doctorSummary.doctor.name}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                      <Badge tone="teal">{doctorSummary.doctor.specialization}</Badge>
                      <Badge tone="neutral">{doctorSummary.doctor.room}</Badge>
                      <Badge tone="normal">Fee: {doctorSummary.doctor.fee}</Badge>
                    </div>
                    <div style={{ marginTop: '12px', color: 'var(--slate-500)', fontSize: '12px' }}>
                      Physician ID: <code>{doctorSummary.doctor.id}</code>
                    </div>
                    <div style={{ marginTop: '14px' }}>
                      <Button
                        variant={doctorSummary.doctor.onDuty ? 'teal' : 'secondary'}
                        disabled={togglingDuty}
                        onClick={() => void toggleDuty(doctorSummary.doctor.onDuty)}
                      >
                        {togglingDuty
                          ? 'Updating…'
                          : doctorSummary.doctor.onDuty
                          ? '🟢 On Duty (Accepting Patients)'
                          : '⚪ Off Duty'}
                      </Button>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--slate-800)', marginBottom: '8px', fontSize: '13.5px' }}>
                      Weekly Working Hours & Schedule
                    </div>
                    {doctorSummary.doctor.schedule ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: 'var(--slate-600)' }}>
                        <div>
                          🗓️ <b>Days:</b> {formatWorkingDays(doctorSummary.doctor.schedule.workingDays)}
                        </div>
                        <div>
                          ⏰ <b>Shift Hours:</b> {doctorSummary.doctor.schedule.startTime} – {doctorSummary.doctor.schedule.endTime}
                        </div>
                        <div>
                          🍱 <b>Lunch Break:</b> {doctorSummary.doctor.schedule.lunchStart} – {doctorSummary.doctor.schedule.lunchEnd}
                        </div>
                        <div>
                          ⏱️ <b>Slot Duration:</b> {doctorSummary.doctor.schedule.slotDurationMinutes || 20} minutes per consultation
                        </div>
                      </div>
                    ) : (
                      <p className="muted" style={{ margin: 0, fontSize: '13px' }}>
                        Standard clinic hours (09:00 - 18:00)
                      </p>
                    )}
                  </div>
                </div>
              </Card>

              {/* Waiting Queue & Today's Appointments Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
                <Card
                  title={`Waiting Queue (${doctorSummary.waitingTokens?.length || 0})`}
                  action={
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {doctorSummary.waitingTokens?.length > 0 && (
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={!!callingTokenId || callingNext}
                          onClick={() => void handleCallNextPatient()}
                          title="Call the next patient in queue"
                        >
                          <Icon name="check" size={14} />
                          <span>{callingNext ? 'Calling…' : 'Call Next Patient'}</span>
                        </Button>
                      )}
                      <Link to="/queue" className="btn btn-sm outline">View full queue →</Link>
                    </div>
                  }
                >
                  {!doctorSummary.waitingTokens || doctorSummary.waitingTokens.length === 0 ? (
                    <EmptyState
                      icon="check"
                      title="No waiting patients"
                      description="Your patient queue is currently clear."
                    />
                  ) : (
                    <div className="queue-list">
                      {doctorSummary.waitingTokens.slice(0, 6).map((item: QueueToken) => (
                        <div className="queue-row" key={item.id}>
                          <div className="token">{item.tokenNumber}</div>
                          <div>
                            <b>{item.patientName}</b>
                            <small>Priority · {item.priority}</small>
                          </div>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <Badge tone={item.priority.toLowerCase()}>{item.priority}</Badge>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={callingTokenId === item.id}
                              onClick={() => void callPatient(item)}
                            >
                              {callingTokenId === item.id ? 'Calling…' : 'Call Next'}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card
                  title={`Today's Appointments (${doctorSummary.todayAppointments?.length || 0})`}
                  action={<Link to="/appointments" className="btn btn-sm outline">Calendar view →</Link>}
                >
                  {!doctorSummary.todayAppointments || doctorSummary.todayAppointments.length === 0 ? (
                    <EmptyState
                      icon="calendar"
                      title="No appointments scheduled"
                      description="No booked appointments scheduled for today."
                    />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {doctorSummary.todayAppointments.slice(0, 6).map((apt: Appointment) => (
                        <div
                          key={apt.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '10px 14px',
                            background: '#fff',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--color-border)',
                          }}
                        >
                          <div>
                            <b style={{ fontSize: '13.5px', color: 'var(--slate-900)' }}>{apt.patientName}</b>
                            <div style={{ color: 'var(--slate-500)', fontSize: '12px', marginTop: '2px' }}>
                              ⏰ Slot: <b>{apt.startTime}</b>
                            </div>
                          </div>
                          <Badge tone={apt.status}>{apt.status}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              {/* My Associated Patients Section */}
              <Card title="My Associated Patients">
                {!doctorSummary.myPatients || doctorSummary.myPatients.length === 0 ? (
                  <EmptyState
                    icon="users"
                    title="No past patient records"
                    description="Consulted patients will appear here automatically."
                  />
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="modern-table">
                      <thead>
                        <tr>
                          <th>Patient Name</th>
                          <th>Demographics</th>
                          <th>Phone</th>
                          <th>Total Visits with Me</th>
                          <th>Last Visit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {doctorSummary.myPatients.slice(0, 8).map((p: any) => (
                          <tr key={p.id}>
                            <td style={{ fontWeight: 600 }}>{p.name}</td>
                            <td>{p.age} yrs • {p.gender}</td>
                            <td>{p.phone}</td>
                            <td><b>{p.visitsCount}</b> visit(s)</td>
                            <td>{p.lastVisit || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* 4. ADMIN HEALTHCARE OS WORKSPACE */}
          {profile?.role === 'ADMIN' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
                {/* Bottom Left Panel: Live Queue Overview */}
                <Card
                  title={`Live Queue (${queue.length})`}
                  subtitle="Emergency → Senior → Normal"
                  action={
                    <Button variant="outline" size="sm" onClick={() => navigate('/queue')}>
                      Manage full queue →
                    </Button>
                  }
                >
                  {queue.length === 0 ? (
                    <EmptyState
                      icon="queue"
                      title="No patients waiting"
                      description="The live intake queue is currently clear."
                      action={
                        <Button variant="primary" size="sm" onClick={() => navigate('/patients')}>
                          + Intake Patient
                        </Button>
                      }
                    />
                  ) : (
                    <div className="queue-list">
                      {queue.map((item) => {
                        const priorityLower = (item.priority || 'NORMAL').toLowerCase();
                        const badgeTone =
                          priorityLower === 'emergency'
                            ? 'emergency'
                            : priorityLower === 'senior'
                            ? 'senior'
                            : 'normal';
                        const triageType =
                          item.doctorSpecialization ||
                          (item.doctorName ? `Dr. ${item.doctorName}` : 'General');

                        return (
                          <div
                            className="queue-row interactive-row"
                            key={item.id}
                            onClick={() => navigate('/queue')}
                            title="Click row to open Master Queue for reassignment"
                            tabIndex={0}
                            role="button"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                navigate('/queue');
                              }
                            }}
                          >
                            <div className="token">{item.tokenNumber}</div>
                            <div>
                              <b style={{ color: 'var(--slate-900)' }}>{item.patientName}</b>
                              <small>Triage · {triageType}</small>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <Badge tone={badgeTone}>{item.priority || 'Normal'}</Badge>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>

                {/* Bottom Right Panel: Today's Appointments & Staff Status */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <Card
                    title={`Today's Appointments (${todayAppointments.length})`}
                    action={
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <Button variant="teal" size="sm" onClick={() => setShowAddUserModal(true)} title="Quickly register a doctor, receptionist, or admin">
                          <Icon name="plus" size={14} />
                          <span>+ Add User</span>
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => navigate('/appointments')}>
                          View all →
                        </Button>
                      </div>
                    }
                  >
                    {todayAppointments.length === 0 ? (
                      <EmptyState
                        icon="calendar"
                        title="No appointments scheduled"
                        description="No appointments booked for today yet."
                        action={
                          <Button variant="primary" size="sm" onClick={() => navigate('/appointments')}>
                            Schedule Appointment
                          </Button>
                        }
                      />
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {todayAppointments.slice(0, 5).map((apt) => {
                          const statusTone =
                            apt.status === 'CANCELLED'
                              ? 'rose'
                              : apt.status === 'COMPLETED'
                              ? 'emerald'
                              : 'blue';
                          return (
                            <div
                              key={apt.id}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '10px 14px',
                                background: '#fff',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--color-border)',
                              }}
                            >
                              <div>
                                <b style={{ fontSize: '13.5px', color: 'var(--slate-900)' }}>{apt.patientName}</b>
                                <div style={{ color: 'var(--slate-500)', fontSize: '12px', marginTop: '2px' }}>
                                  ⏰ {apt.startTime} · Dr. {apt.doctorName || 'General'}
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <Badge tone={apt.status}>{apt.status}</Badge>
                                {(apt.status === 'BOOKED' || apt.status === 'CONFIRMED') && (
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    disabled={checkingInId === apt.id}
                                    onClick={() => void quickCheckIn(apt)}
                                    title="Check-in patient to queue"
                                  >
                                    {checkingInId === apt.id ? 'Checking in…' : 'Check-In'}
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Card>

                  {/* System Health Widget */}
                  <div className="system-health-box">
                    <div className="system-health-header">
                      <span>Live Microservices Health</span>
                      <small style={{ color: 'var(--slate-400)', fontSize: '11px' }}>Continuous Telemetry</small>
                    </div>
                    <div className="system-health-grid">
                      <div className={`health-status-badge ${systemHealth.telegram ? 'online' : 'offline'}`}>
                        <span className={`health-indicator-dot ${systemHealth.telegram ? 'online' : 'offline'}`} />
                        <span>{systemHealth.telegram ? '🟢 Telegram Bot Online' : '🔴 Telegram Bot Offline'}</span>
                      </div>
                      <div className={`health-status-badge ${systemHealth.rag ? 'online' : 'offline'}`}>
                        <span className={`health-indicator-dot ${systemHealth.rag ? 'online' : 'offline'}`} />
                        <span>{systemHealth.rag ? '🟢 RAG AI Online' : '🔴 RAG AI Offline'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Care Team Availability Card */}
              <Card
                title="Care Team Availability"
                subtitle="Active physicians and consultation room coverage"
              >
                {doctorsList.length === 0 ? (
                  <EmptyState
                    icon="users"
                    title="No doctors configured"
                    description="No active physicians found in clinic system."
                  />
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                      gap: '14px',
                    }}
                  >
                    {doctorsList.map((doc) => (
                      <div
                        key={doc.id}
                        style={{
                          padding: '14px',
                          background: '#fff',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid var(--color-border)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <b style={{ color: 'var(--slate-900)', fontSize: '14px' }}>
                            Dr. {doc.name}
                          </b>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              fontSize: '11px',
                              fontWeight: 600,
                              color: doc.onDuty ? 'var(--emerald-600)' : 'var(--slate-400)',
                            }}
                          >
                            <span
                              style={{
                                width: '7px',
                                height: '7px',
                                borderRadius: '50%',
                                background: doc.onDuty ? 'var(--emerald-500)' : 'var(--slate-400)',
                              }}
                            />
                            {doc.onDuty ? 'On Duty' : 'Off Duty'}
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--teal-700)', fontWeight: 500 }}>
                          {doc.specialization || 'General Physician'}
                        </div>
                        <div style={{ fontSize: '11.5px', color: 'var(--slate-500)', display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                          <span>{doc.room || 'Cabin 101'}</span>
                          <span>Fee: {doc.fee || '$35'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* 5. RECEPTIONIST WORKSPACE */}
          {profile?.role === 'RECEPTIONIST' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
                {/* Live Queue Preview */}
                <Card
                  title={`Live Queue (${queue.length})`}
                  subtitle="Ordered: Emergency → Senior (60+) → Normal FIFO"
                  action={
                    <Link to="/queue" className="btn btn-sm outline">
                      Manage full queue →
                    </Link>
                  }
                >
                  {queue.length === 0 ? (
                    <EmptyState
                      icon="queue"
                      title="Queue is clear"
                      description="No patients are currently waiting in the intake queue."
                      action={
                        <Button variant="primary" size="sm" onClick={() => navigate('/patients')}>
                          + Intake Patient
                        </Button>
                      }
                    />
                  ) : (
                    <div className="queue-list">
                      {queue.map((item) => (
                        <div className="queue-row" key={item.id}>
                          <div className="token">{item.tokenNumber}</div>
                          <div>
                            <b>{item.patientName}</b>
                            <small>
                              {item.doctorName ? `Dr. ${item.doctorName}` : 'General Triage'}
                              {item.doctorSpecialization ? ` (${item.doctorSpecialization})` : ''}
                            </small>
                          </div>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <Badge tone={item.priority.toLowerCase()}>{item.priority}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                {/* Today's Appointments Preview */}
                <Card
                  title={`Today's Appointments (${todayAppointments.length})`}
                  subtitle="Scheduled slots with real-time arrival check-in"
                  action={
                    <Link to="/appointments" className="btn btn-sm outline">
                      View all appointments →
                    </Link>
                  }
                >
                  {todayAppointments.length === 0 ? (
                    <EmptyState
                      icon="calendar"
                      title="No appointments today"
                      description="No patients booked for today's clinic schedule."
                      action={
                        <Button variant="primary" size="sm" onClick={() => navigate('/appointments')}>
                          + Book Appointment
                        </Button>
                      }
                    />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {todayAppointments.slice(0, 6).map((apt) => (
                        <div
                          key={apt.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '10px 14px',
                            background: '#fff',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--color-border)',
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <span style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--slate-900)' }}>
                                {apt.patientName}
                              </span>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <Badge tone={apt.status}>{apt.status}</Badge>
                                {(apt.status === 'BOOKED' || apt.status === 'CONFIRMED') && (
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    disabled={checkingInId === apt.id}
                                    onClick={() => void quickCheckIn(apt)}
                                    title="Check-in patient to queue"
                                  >
                                    {checkingInId === apt.id ? 'Checking in…' : 'Check-In'}
                                  </Button>
                                )}
                              </div>
                            </div>
                            <div style={{ color: 'var(--slate-500)', fontSize: '12px', marginTop: '2px' }}>
                              Slot: <b>{apt.startTime}</b> · Dr. {apt.doctorName || 'Doctor'}
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            {(apt.status === 'BOOKED' || apt.status === 'CONFIRMED') && (
                              <Button
                                variant="teal"
                                size="sm"
                                disabled={checkingInId === apt.id}
                                onClick={() => void quickCheckIn(apt)}
                                title="Check in arrived patient and generate queue token"
                              >
                                {checkingInId === apt.id ? 'Checking in…' : 'Check In'}
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              {/* Care Team Availability Card */}
              <Card
                title="Care Team Availability"
                subtitle="Active physicians and consultation room coverage"
              >
                {doctorsList.length === 0 ? (
                  <EmptyState
                    icon="users"
                    title="No doctors configured"
                    description="No active physicians found in clinic system."
                  />
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                      gap: '14px',
                    }}
                  >
                    {doctorsList.map((doc) => (
                      <div
                        key={doc.id}
                        style={{
                          padding: '14px',
                          background: '#fff',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid var(--color-border)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <b style={{ color: 'var(--slate-900)', fontSize: '14px' }}>
                            Dr. {doc.name}
                          </b>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              fontSize: '11px',
                              fontWeight: 600,
                              color: doc.onDuty ? 'var(--emerald-600)' : 'var(--slate-400)',
                            }}
                          >
                            <span
                              style={{
                                width: '7px',
                                height: '7px',
                                borderRadius: '50%',
                                background: doc.onDuty ? 'var(--emerald-500)' : 'var(--slate-400)',
                              }}
                            />
                            {doc.onDuty ? 'On Duty' : 'Off Duty'}
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--teal-700)', fontWeight: 500 }}>
                          {doc.specialization || 'General Physician'}
                        </div>
                        <div style={{ fontSize: '11.5px', color: 'var(--slate-500)', display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                          <span>{doc.room || 'Cabin 101'}</span>
                          <span>Fee: {doc.fee || '$35'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* 6. ADMIN WORKSPACE: DOCTOR-WISE PATIENT MANAGEMENT */}
          {profile?.role === 'ADMIN' && (
            <div style={{ marginTop: '28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ borderBottom: '2px solid var(--color-border)', paddingBottom: '10px' }}>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--slate-900)' }}>
                  Doctor-Wise Patient Management
                </h2>
                <p style={{ margin: '4px 0 0 0', color: 'var(--slate-500)', fontSize: '13.5px' }}>
                  Monitor individual physician workloads, distinguish unique patients from total visits, and inspect associated patient records.
                </p>
              </div>

              {/* Doctor Selector Cards */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: '12px',
                }}
              >
                {doctorWiseData.map((doc) => {
                  const isSelected = doc.id === selectedDoctorId;
                  return (
                    <div
                      key={doc.id}
                      onClick={() => setSelectedDoctorId(doc.id)}
                      style={{
                        padding: '14px',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        border: isSelected ? '2px solid var(--teal-600)' : '1px solid var(--color-border)',
                        background: isSelected ? 'var(--teal-50)' : '#ffffff',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <b style={{ color: isSelected ? 'var(--teal-800)' : 'var(--slate-900)' }}>
                          Dr. {doc.name}
                        </b>
                        <span
                          style={{
                            display: 'inline-block',
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: doc.onDuty ? 'var(--emerald-500)' : 'var(--slate-400)',
                          }}
                        />
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--slate-500)', marginTop: '2px' }}>
                        {doc.specialization}
                      </div>

                      <div style={{ marginTop: '10px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Unique: <b>{doc.metrics.uniquePatientsCount}</b></span>
                        <span>Visits: <b>{doc.metrics.totalVisitsCount}</b></span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Selected Doctor Detailed Overview */}
              {selectedDoctor && (
                <Card
                  title={`Dr. ${selectedDoctor.name} (${selectedDoctor.specialization}) — Operations & Patient Records`}
                >
                  {/* Doctor Metrics Grid */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                      gap: '10px',
                      marginBottom: '20px',
                    }}
                  >
                    <div style={{ background: '#f8fafc', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                      <small style={{ color: 'var(--slate-500)', fontSize: '11px', fontWeight: 600 }}>UNIQUE PATIENTS</small>
                      <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--teal-700)' }}>
                        {selectedDoctor.metrics.uniquePatientsCount}
                      </div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                      <small style={{ color: 'var(--slate-500)', fontSize: '11px', fontWeight: 600 }}>TOTAL VISITS</small>
                      <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--slate-900)' }}>
                        {selectedDoctor.metrics.totalVisitsCount}
                      </div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                      <small style={{ color: 'var(--slate-500)', fontSize: '11px', fontWeight: 600 }}>TODAY'S APTS</small>
                      <div style={{ fontSize: '22px', fontWeight: 800 }}>
                        {selectedDoctor.metrics.todayAppointmentsCount}
                      </div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                      <small style={{ color: 'var(--slate-500)', fontSize: '11px', fontWeight: 600 }}>WAITING</small>
                      <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--amber-600)' }}>
                        {selectedDoctor.metrics.waitingCount}
                      </div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                      <small style={{ color: 'var(--slate-500)', fontSize: '11px', fontWeight: 600 }}>COMPLETED</small>
                      <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--emerald-600)' }}>
                        {selectedDoctor.metrics.completedCount}
                      </div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                      <small style={{ color: 'var(--slate-500)', fontSize: '11px', fontWeight: 600 }}>CANCELLED</small>
                      <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--rose-600)' }}>
                        {selectedDoctor.metrics.cancelledCount}
                      </div>
                    </div>
                  </div>

                  {/* Doctor Schedule and Details */}
                  <div style={{ background: 'var(--teal-50)', padding: '12px 16px', borderRadius: 'var(--radius-md)', marginBottom: '16px', fontSize: '12.5px', border: '1px solid var(--teal-200)', color: 'var(--teal-900)' }}>
                    <b>Clinic Schedule:</b> Working Hours: {selectedDoctor.schedule?.startTime || '09:00'} - {selectedDoctor.schedule?.endTime || '17:00'} •
                    Lunch Break: {selectedDoctor.schedule?.lunchStart || '13:00'} - {selectedDoctor.schedule?.lunchEnd || '14:00'} •
                    Slot Duration: {selectedDoctor.schedule?.slotDurationMinutes || 20} mins • Max Appointments: {selectedDoctor.schedule?.maxAppointments || 20}
                  </div>

                  {/* Search and Filters */}
                  <div
                    style={{
                      display: 'flex',
                      gap: '12px',
                      flexWrap: 'wrap',
                      marginBottom: '16px',
                      alignItems: 'center',
                    }}
                  >
                    <input
                      style={{ flex: 1, minWidth: '220px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '9px 12px' }}
                      value={patientSearch}
                      onChange={(e) => setPatientSearch(e.target.value)}
                      placeholder="Search patient by name or phone…"
                    />
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      style={{ padding: '9px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: '#fff' }}
                    >
                      <option value="ALL">All Statuses</option>
                      <option value="BOOKED">Booked</option>
                      <option value="COMPLETED">Completed</option>
                      <option value="CANCELLED">Cancelled</option>
                    </select>
                  </div>

                  {/* Associated Patients Table */}
                  <div style={{ overflowX: 'auto' }}>
                    <table className="modern-table">
                      <thead>
                        <tr>
                          <th>Patient Name</th>
                          <th>Demographics</th>
                          <th>Phone</th>
                          <th>Total Visits with Dr. {selectedDoctor.name.split(' ')[0]}</th>
                          <th>Last Visit Date</th>
                          <th>Recent Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPatients.length === 0 ? (
                          <tr>
                            <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--slate-500)' }}>
                              No patients match the search criteria for Dr. {selectedDoctor.name}.
                            </td>
                          </tr>
                        ) : (
                          filteredPatients.map((p) => (
                            <tr key={p.id}>
                              <td style={{ fontWeight: 600 }}>{p.name}</td>
                              <td>{p.age} yrs • {p.gender}</td>
                              <td>{p.phone}</td>
                              <td><b>{p.totalVisits}</b> visit(s)</td>
                              <td>{p.lastVisitDate || '—'}</td>
                              <td>
                                <Badge tone={p.recentStatus}>{p.recentStatus}</Badge>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Recent Consultations List */}
                  {selectedDoctor.recentConsultations && selectedDoctor.recentConsultations.length > 0 && (
                    <details style={{ marginTop: '20px' }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--slate-700)' }}>
                        View Recent Consultations conducted by Dr. {selectedDoctor.name} ({selectedDoctor.recentConsultations.length})
                      </summary>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                        {selectedDoctor.recentConsultations.map((c) => (
                          <div
                            key={c.id}
                            style={{
                              padding: '12px 16px',
                              background: '#f8fafc',
                              border: '1px solid var(--color-border)',
                              borderRadius: 'var(--radius-md)',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <b>{c.patientName}</b>
                              <small style={{ color: 'var(--slate-500)' }}>{c.createdAt ? c.createdAt.split('T')[0] : ''}</small>
                            </div>
                            <div style={{ fontSize: '13px', marginTop: '3px' }}>
                              <b>Diagnosis:</b> {c.diagnosis}
                            </div>
                            {c.notes && (
                              <p style={{ margin: '2px 0 0 0', color: 'var(--slate-500)', fontSize: '12px' }}>
                                {c.notes}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </Card>
              )}
            </div>
          )}
        </>
      )}

      {/* Add New User Modal (Healthcare OS Shortcut) */}
      <Modal
        isOpen={showAddUserModal}
        onClose={() => {
          setShowAddUserModal(false);
          setUserCreateError('');
          setUserCreateSuccess('');
        }}
        title="Add New User & Assign Role"
        maxWidth="540px"
      >
        <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {userCreateError && (
            <div className="error" role="alert" style={{ margin: 0 }}>
              {userCreateError}
            </div>
          )}
          {userCreateSuccess && (
            <div className="success" role="status" style={{ margin: 0 }}>
              {userCreateSuccess}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--slate-700)' }}>
              Full Name <span style={{ color: 'var(--rose-500)' }}>*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Dr. Jennifer Smith"
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
              style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--slate-700)' }}>
              Email Address <span style={{ color: 'var(--rose-500)' }}>*</span>
            </label>
            <input
              type="email"
              required
              placeholder="user@clinicqueue.health"
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.target.value)}
              style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--slate-700)' }}>
              Initial Password <span style={{ color: 'var(--rose-500)' }}>* (Min. 6 chars)</span>
            </label>
            <div className="password-input-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={6}
                placeholder="Temporary login password"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} />
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--slate-700)' }}>
              System Role <span style={{ color: 'var(--rose-500)' }}>*</span>
            </label>
            <select
              value={newUserRole}
              onChange={(e) => setNewUserRole(e.target.value as any)}
              style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: '#fff' }}
            >
              <option value="DOCTOR">Doctor (Attending Physician)</option>
              <option value="RECEPTIONIST">Receptionist (Front-Desk Staff)</option>
              <option value="ADMIN">System Administrator</option>
            </select>
          </div>

          {newUserRole === 'DOCTOR' && (
            <div style={{ background: '#f8fafc', padding: '14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--teal-800)', textTransform: 'uppercase' }}>
                Physician Credentials & Schedule
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--slate-600)' }}>Specialization</label>
                  <input
                    type="text"
                    value={newUserSpecialization}
                    onChange={(e) => setNewUserSpecialization(e.target.value)}
                    placeholder="General Medicine"
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', marginTop: '4px' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--slate-600)' }}>Room / Cabin</label>
                  <input
                    type="text"
                    value={newUserRoom}
                    onChange={(e) => setNewUserRoom(e.target.value)}
                    placeholder="Cabin 101"
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', marginTop: '4px' }}
                  />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--slate-600)' }}>Consultation Fee</label>
                <input
                  type="text"
                  value={newUserFee}
                  onChange={(e) => setNewUserFee(e.target.value)}
                  placeholder="$40"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', marginTop: '4px' }}
                />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
            <Button
              variant="outline"
              onClick={() => {
                setShowAddUserModal(false);
                setUserCreateError('');
                setUserCreateSuccess('');
              }}
            >
              Cancel
            </Button>
            <Button variant="teal" type="submit" disabled={userCreateSubmitting}>
              {userCreateSubmitting ? 'Creating User…' : 'Create User'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
