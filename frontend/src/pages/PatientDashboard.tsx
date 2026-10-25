import { useEffect, useState } from 'react';
import { Card, Badge, Button } from '../components/Ui';
import { useAuth } from '../context/AuthContext';
import { get, post, downloadFile, getFileBlobUrl } from '../services/api';
import type {
  PatientDashboardData,
  Appointment,
  Prescription,
  Consultation,
} from '../types';

export default function PatientDashboard() {
  const { profile } = useAuth();
  const [data, setData] = useState<PatientDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Linking code generation
  const [generatingCode, setGeneratingCode] = useState(false);
  const [linkingCodeInfo, setLinkingCodeInfo] = useState<{
    code: string;
    expiresAt: string;
    botUsername: string;
    instructions: string;
  } | null>(null);

  // Prescription preview modal
  const [previewPrescription, setPreviewPrescription] = useState<Prescription | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string>('');

  // Appointment cancellation
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function loadDashboard() {
    setError('');
    try {
      const res = await get<PatientDashboardData>('/patient-portal/dashboard');
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Unable to load your patient dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  async function generateTelegramLinkCode() {
    setGeneratingCode(true);
    setError('');
    try {
      const res = await post<any>('/patient-portal/generate-link-code');
      setLinkingCodeInfo(res);
      setSuccessMsg('Linking code generated! Open Telegram and send the code to @Clinical_oops_bot');
    } catch (err: any) {
      setError(err.message || 'Failed to generate linking code.');
    } finally {
      setGeneratingCode(false);
    }
  }

  async function cancelAppointment(apt: Appointment) {
    if (!confirm(`Are you sure you want to cancel your appointment with Dr. ${apt.doctorName} on ${apt.date} at ${apt.startTime}?`)) {
      return;
    }
    setCancellingId(apt.id);
    setError('');
    try {
      await post(`/patient-portal/cancel-appointment/${apt.id}`);
      setSuccessMsg(`Appointment on ${apt.date} has been cancelled.`);
      await loadDashboard();
    } catch (err: any) {
      setError(err.message || 'Unable to cancel appointment.');
    } finally {
      setCancellingId(null);
    }
  }

  async function openPdfPreview(rx: Prescription) {
    try {
      const url = await getFileBlobUrl(rx.downloadUrl);
      setPreviewBlobUrl(url);
      setPreviewPrescription(rx);
    } catch (err: any) {
      setError(err.message || 'Unable to load PDF preview.');
    }
  }

  function printPrescription(url: string) {
    const printWindow = window.open(url, '_blank');
    if (printWindow) {
      printWindow.focus();
      printWindow.print();
    }
  }

  if (loading) return <div className="loading-panel">Loading your patient dashboard…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div className="pagehead">
        <div>
          <div className="eyebrow">PATIENT PORTAL</div>
          <h1>Welcome, {data?.patient.name || profile?.name}</h1>
          <p>Manage your appointments, track queue status, and view prescriptions.</p>
        </div>
        <Button variant="secondary" onClick={() => void loadDashboard()}>
          🔄 Refresh
        </Button>
      </div>

      {error && <div className="error page-error" role="alert">{error}</div>}
      {successMsg && <div className="success" role="status" style={{ padding: '12px' }}>{successMsg}</div>}

      {/* Profile & Live Queue Banner */}
      <div className="grid2">
        {/* Profile Card */}
        <Card title="Patient Profile">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <small style={{ color: '#64748b', fontWeight: 600 }}>NAME</small>
              <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>{data?.patient.name}</div>
            </div>
            <div>
              <small style={{ color: '#64748b', fontWeight: 600 }}>PHONE</small>
              <div>{data?.patient.phone || '—'}</div>
            </div>
            <div>
              <small style={{ color: '#64748b', fontWeight: 600 }}>AGE / GENDER</small>
              <div>{data?.patient.age} years • {data?.patient.gender}</div>
            </div>
            <div>
              <small style={{ color: '#64748b', fontWeight: 600 }}>PATIENT ID</small>
              <div style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{data?.patient.id.slice(0, 12)}</div>
            </div>
          </div>
        </Card>

        {/* Live Queue Token Card */}
        <Card title="Today's Live Queue Status">
          {data?.activeQueue ? (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#1e3a8a' }}>
                  {data.activeQueue.tokenNumber}
                </div>
                <Badge tone={data.activeQueue.status === 'CALLED' ? 'emergency' : 'senior'}>
                  {data.activeQueue.status}
                </Badge>
              </div>

              {data.activeQueue.status === 'CALLED' ? (
                <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', padding: '12px', borderRadius: '6px', color: '#991b1b' }}>
                  📢 <b>It's your turn!</b> Your token has been called. Please proceed directly to the doctor's consultation room.
                </div>
              ) : (
                <div style={{ background: '#f0fdf4', border: '1px solid #86efac', padding: '12px', borderRadius: '6px', color: '#166534' }}>
                  <div>
                    <b>Queue Position:</b> You are <b>#{data.activeQueue.position}</b> in line.
                  </div>
                  <div>
                    <b>Waiting ahead:</b> {data.activeQueue.aheadCount} patient(s) ahead of you.
                  </div>
                  {data.activeQueue.estimatedWaitMinutes !== undefined && (
                    <div style={{ marginTop: '4px', fontSize: '0.85rem', color: '#15803d' }}>
                      ⏱️ Estimated wait: ~{data.activeQueue.estimatedWaitMinutes} minutes.
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="empty" style={{ padding: '16px 0' }}>
              No active queue token for today. Request a walk-in token at the clinic reception or via Telegram.
            </div>
          )}
        </Card>
      </div>

      {/* Telegram Linking Card */}
      <Card title="Telegram Prescription & Queue Delivery">
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '20px', alignItems: 'center' }}>
          <div>
            <p style={{ margin: '0 0 8px 0', color: '#334155' }}>
              Link your Telegram account to receive prescriptions as instant PDFs and real-time alerts when your queue token is called.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <b>Current Status:</b>
              {data?.telegram.isLinked ? (
                <Badge tone="normal">✅ Linked ({data.telegram.chatIdMasked})</Badge>
              ) : (
                <Badge tone="senior">⚠️ Not Linked</Badge>
              )}
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            {!data?.telegram.isLinked && (
              <Button disabled={generatingCode} onClick={() => void generateTelegramLinkCode()}>
                {generatingCode ? 'Generating…' : 'Generate 6-Digit Linking Code'}
              </Button>
            )}
          </div>
        </div>

        {linkingCodeInfo && !data?.telegram.isLinked && (
          <div
            style={{
              marginTop: '16px',
              background: '#f8fafc',
              border: '2px dashed #0284c7',
              borderRadius: '8px',
              padding: '16px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '0.9rem', color: '#0369a1', fontWeight: 600 }}>
              YOUR 6-DIGIT VERIFICATION CODE
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '6px', color: '#0f172a', margin: '8px 0' }}>
              {linkingCodeInfo.code}
            </div>
            <p style={{ fontSize: '0.85rem', color: '#475569', margin: 0 }}>
              Open <b>@{linkingCodeInfo.botUsername}</b> on Telegram and send:
              <br />
              <code style={{ background: '#e2e8f0', padding: '2px 8px', borderRadius: '4px', fontSize: '0.95rem' }}>
                /link {linkingCodeInfo.code}
              </code>
            </p>
          </div>
        )}
      </Card>

      {/* Appointments: Upcoming & Past */}
      <Card title="My Appointments">
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '8px', color: '#1e293b' }}>Upcoming Appointments</h3>
          {data?.upcomingAppointments && data.upcomingAppointments.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {data.upcomingAppointments.map((apt) => (
                <div
                  key={apt.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 16px',
                    background: '#f8fafc',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '1rem' }}>Dr. {apt.doctorName}</div>
                    <div style={{ color: '#64748b', fontSize: '0.85rem' }}>
                      {apt.doctorSpecialization} • {apt.doctorRoom || 'Consultation Room'}
                    </div>
                    <div style={{ marginTop: '4px', fontSize: '0.9rem' }}>
                      📅 <b>{apt.date}</b> at <b>{apt.startTime}</b>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <Badge tone="normal">{apt.status}</Badge>
                    <button
                      type="button"
                      className="link"
                      style={{ color: '#dc2626', fontSize: '0.85rem' }}
                      disabled={cancellingId === apt.id}
                      onClick={() => void cancelAppointment(apt)}
                    >
                      {cancellingId === apt.id ? 'Cancelling…' : 'Cancel appointment'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty" style={{ padding: '12px 0' }}>No upcoming appointments booked.</div>
          )}
        </div>

        {data?.pastAppointments && data.pastAppointments.length > 0 && (
          <details style={{ marginTop: '16px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#475569' }}>
              Past Appointments History ({data.pastAppointments.length})
            </summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
              {data.pastAppointments.map((apt) => (
                <div
                  key={apt.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: '#ffffff',
                    border: '1px solid #f1f5f9',
                    borderRadius: '4px',
                  }}
                >
                  <div>
                    <b>Dr. {apt.doctorName}</b> ({apt.doctorSpecialization})
                    <span style={{ color: '#64748b', marginLeft: '8px' }}>{apt.date} at {apt.startTime}</span>
                  </div>
                  <Badge tone={apt.status === 'CANCELLED' ? 'senior' : 'normal'}>{apt.status}</Badge>
                </div>
              ))}
            </div>
          </details>
        )}
      </Card>

      {/* Consultations History */}
      <Card title="Consultation History">
        {data?.consultations && data.consultations.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {data.consultations.map((c) => (
              <div
                key={c.id}
                style={{
                  padding: '14px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <div style={{ fontWeight: 600, fontSize: '1rem', color: '#1e3a8a' }}>
                    Dr. {c.doctorName}
                    <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 400, marginLeft: '6px' }}>
                      ({c.doctorSpecialization || 'Physician'})
                    </span>
                  </div>
                  <span style={{ color: '#64748b', fontSize: '0.85rem' }}>
                    {c.createdAt ? c.createdAt.split('T')[0] : '—'}
                  </span>
                </div>
                <div style={{ fontSize: '0.95rem', marginBottom: '4px' }}>
                  <b>Diagnosis:</b> {c.diagnosis}
                </div>
                {c.notes && (
                  <p style={{ margin: '4px 0 0 0', color: '#475569', fontSize: '0.88rem' }}>
                    <b>Clinical Notes:</b> {c.notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">No past consultations recorded.</div>
        )}
      </Card>

      {/* Prescriptions */}
      <Card title="Prescriptions">
        {data?.prescriptions && data.prescriptions.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {data.prescriptions.map((rx) => (
              <div
                key={rx.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '14px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                    Prescription #{rx.id.slice(0, 10)}
                  </div>
                  <div style={{ color: '#64748b', fontSize: '0.85rem' }}>
                    Dr. {rx.doctorName || 'Physician'} • {rx.createdAt ? rx.createdAt.split('T')[0] : '—'}
                  </div>
                  {rx.medications && rx.medications.length > 0 && (
                    <div style={{ fontSize: '0.85rem', marginTop: '4px', color: '#334155' }}>
                      <b>Medications:</b> {rx.medications.map((m) => m.name).join(', ')}
                    </div>
                  )}
                  {rx.telegramDelivery && (
                    <div style={{ marginTop: '4px' }}>
                      <small style={{ color: '#64748b' }}>
                        Telegram status:{' '}
                        <b>{rx.telegramDelivery.status}</b>
                      </small>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button variant="secondary" onClick={() => void openPdfPreview(rx)}>
                    👁️ Preview PDF
                  </Button>
                  <Button
                    onClick={() =>
                      void downloadFile(rx.downloadUrl, `prescription-${rx.id}.pdf`).catch(
                        (err) => setError(err.message),
                      )
                    }
                  >
                    📥 Download
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">No prescriptions issued yet.</div>
        )}
      </Card>

      {/* PDF Preview Modal */}
      {previewPrescription && previewBlobUrl && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '24px',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '8px',
              padding: '20px',
              width: '90%',
              maxWidth: '850px',
              height: '85vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0 }}>Prescription Preview #{previewPrescription.id.slice(0, 10)}</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button variant="secondary" onClick={() => printPrescription(previewBlobUrl)}>
                  🖨️ Print
                </Button>
                <Button
                  onClick={() =>
                    void downloadFile(
                      previewPrescription.downloadUrl,
                      `prescription-${previewPrescription.id}.pdf`,
                    ).catch((err) => setError(err.message))
                  }
                >
                  📥 Download
                </Button>
                <Button variant="secondary" onClick={() => setPreviewPrescription(null)}>
                  ✕ Close
                </Button>
              </div>
            </div>

            <iframe
              src={previewBlobUrl}
              style={{ flex: 1, width: '100%', border: '1px solid #cbd5e1', borderRadius: '4px' }}
              title="Prescription PDF"
            />
          </div>
        </div>
      )}
    </div>
  );
}
