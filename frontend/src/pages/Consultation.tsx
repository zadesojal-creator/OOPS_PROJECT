import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card } from '../components/Ui';
import { downloadFile, get, post, getFileBlobUrl } from '../services/api';
import type {
  Consultation,
  Medication,
  Patient,
  Prescription,
  QueueToken,
} from '../types';

const emptyMedication: Medication = {
  name: '',
  dosage: '1 tablet',
  frequency: '1-0-1',
  duration: '5 days',
  instructions: 'After meals',
};

export default function ConsultationPage() {
  const { queueId = '' } = useParams();
  const navigate = useNavigate();

  // Consultation state
  const [queue, setQueue] = useState<QueueToken | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [pastConsultations, setPastConsultations] = useState<Consultation[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const [diagnosis, setDiagnosis] = useState('');
  const [notes, setNotes] = useState('');
  const [consultation, setConsultation] = useState<Consultation | null>(null);

  // Prescription state
  const [medications, setMedications] = useState<Medication[]>([{ ...emptyMedication }]);
  const [instructions, setInstructions] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [prescription, setPrescription] = useState<Prescription | null>(null);

  // Telegram modal state
  const [showTelegramModal, setShowTelegramModal] = useState(false);
  const [recipientPhone, setRecipientPhone] = useState('');
  const [recipientVerification, setRecipientVerification] = useState<{
    matched?: boolean;
    isLinked?: boolean;
    patientName?: string;
    phoneMasked?: string;
    message?: string;
  } | null>(null);
  const [verifyingRecipient, setVerifyingRecipient] = useState(false);
  const [sendingTelegram, setSendingTelegram] = useState(false);
  const [telegramDeliveryStatus, setTelegramDeliveryStatus] = useState<any>(null);

  // Email delivery state
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailDeliveryStatus, setEmailDeliveryStatus] = useState<any>(null);

  // RAG clinical reference state
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<{ source: string; excerpt: string }[]>([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [callingNextPatient, setCallingNextPatient] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Call Next Patient
  async function callNextPatient() {
    setCallingNextPatient(true);
    setError('');
    try {
      const res = await post<any>('/queue/call-next');
      if (res && res.id) {
        navigate(`/consultations/${res.id}`);
      } else {
        setError('No waiting patients in queue.');
      }
    } catch (err: any) {
      setError(err.message || 'No waiting patients in queue.');
    } finally {
      setCallingNextPatient(false);
    }
  }

  // 1. Initial Load
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [called, visits] = await Promise.all([
          get<QueueToken[]>('/queue?status=CALLED'),
          get<Consultation[]>(`/consultations?queueId=${encodeURIComponent(queueId)}`),
        ]);
        if (!active) return;

        let current = called.find((item) => item.id === queueId);
        if (!current && visits[0]) {
          // Consultation was already completed
          current = {
            id: queueId,
            tokenNumber: '—',
            patientId: visits[0].patientId,
            patientName: visits[0].patientName,
            priority: 'NORMAL',
            status: 'COMPLETED',
            createdAt: visits[0].createdAt,
          };
        }

        if (!current) {
          setError('This queue token is not currently active.');
        } else {
          setQueue(current);
          setRecipientPhone('');

          // Fetch patient profile & past consultations
          if (current.patientId) {
            try {
              const pData = await get<Patient>(`/patients/${current.patientId}`);
              if (active) {
                setPatient(pData);
                setRecipientPhone(pData.phone || '');
                setRecipientEmail(pData.email || '');
                if (pData.consultations) {
                  setPastConsultations(
                    pData.consultations.filter((c) => c.queueId !== queueId),
                  );
                }
              }
            } catch (err) {
              console.warn('Could not load patient profile', err);
            }
          }
        }

        if (visits[0]) {
          setConsultation(visits[0]);
          setDiagnosis(visits[0].diagnosis || '');
          setNotes(visits[0].notes || '');

          // Check if prescription exists for this consultation
          try {
            const rxList = await get<Prescription[]>(
              `/prescriptions?consultationId=${encodeURIComponent(visits[0].id)}`,
            );
            if (active && rxList && rxList[0]) {
              setPrescription(rxList[0]);
              if (rxList[0].telegramDelivery) {
                setTelegramDeliveryStatus(rxList[0].telegramDelivery);
              }
              if (rxList[0].emailDelivery) {
                setEmailDeliveryStatus(rxList[0].emailDelivery);
              }
            }
          } catch {
            // Prescriptions could be empty
          }
        }
      } catch (reason) {
        if (active) {
          setError(
            reason instanceof Error ? reason.message : 'Unable to load consultation details.',
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [queueId]);

  // 2. Save Consultation
  async function saveConsultation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!queue) return;
    if (!diagnosis.trim()) {
      setError('Please provide a clinical diagnosis.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccessMsg('');
    try {
      const result = await post<Consultation>('/consultations', {
        queueId: queue.id,
        diagnosis: diagnosis.trim(),
        notes: notes.trim(),
        patientId: queue.patientId,
      });
      setConsultation(result);
      setQueue({ ...queue, status: 'COMPLETED' });
      setSuccessMsg('Consultation recorded successfully! You can now create a prescription.');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to save consultation record.',
      );
    } finally {
      setSaving(false);
    }
  }

  // 3. Medication Row Helpers
  function updateMedication(index: number, key: keyof Medication, value: string) {
    setMedications((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    );
  }

  function addMedication() {
    if (medications.length < 20) {
      setMedications((current) => [...current, { ...emptyMedication }]);
    }
  }

  function removeMedication(index: number) {
    if (medications.length > 1) {
      setMedications((current) => current.filter((_, i) => i !== index));
    }
  }

  // 4. Save Prescription and Generate PDF
  async function savePrescription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consultation) return;

    // Validate medication rows
    for (let i = 0; i < medications.length; i++) {
      const m = medications[i];
      if (!m.name.trim()) {
        setError(`Please enter a medication name for row #${i + 1}.`);
        return;
      }
    }

    setSaving(true);
    setError('');
    try {
      const result = await post<Prescription>('/prescriptions', {
        consultationId: consultation.id,
        medications: medications.map((m) => ({
          name: m.name.trim(),
          dosage: m.dosage.trim(),
          frequency: m.frequency.trim(),
          duration: m.duration.trim(),
          instructions: m.instructions?.trim() || '',
        })),
        instructions: instructions.trim(),
        followUpDate: followUpDate.trim(),
      });
      setPrescription(result);
      if (result.telegramDelivery) {
        setTelegramDeliveryStatus(result.telegramDelivery);
      }
      if (result.emailDelivery) {
        setEmailDeliveryStatus(result.emailDelivery);
      }
      if (result.telegramDelivery?.status === 'SENT' && result.emailDelivery?.status === 'SENT') {
        setSuccessMsg('Prescription saved, PDF generated, and delivered to Telegram and Email!');
      } else if (result.emailDelivery?.status === 'SENT') {
        setSuccessMsg('Prescription saved, PDF generated, and delivered directly to patient email!');
      } else if (result.telegramDelivery?.status === 'SENT') {
        setSuccessMsg('Prescription saved, professional PDF generated, and automatically delivered to patient Telegram!');
      } else if (result.telegramDelivery?.status === 'TELEGRAM_NOT_CONFIGURED') {
        setSuccessMsg('Prescription saved and PDF generated. You can now send it to the patient via Email.');
      } else {
        setSuccessMsg('Prescription saved and professional PDF generated successfully!');
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Prescription PDF generation failed.',
      );
    } finally {
      setSaving(false);
    }
  }

  // 5. Send via Email
  async function sendViaEmail() {
    if (!prescription) return;
    const target = recipientEmail.trim().toLowerCase();
    if (!target || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setError('Please provide a valid recipient email address (e.g. name@domain.com).');
      return;
    }
    setSendingEmail(true);
    setError('');
    try {
      const res = await post<any>(`/prescriptions/${prescription.id}/send-email`, {
        email: target,
      });
      setEmailDeliveryStatus(res.emailDelivery || { status: 'SENT', sentAt: new Date().toISOString(), recipientEmail: target });
      setSuccessMsg(`Official prescription PDF successfully delivered to ${target}!`);
      if (patient) {
        setPatient({ ...patient, email: target });
      }
      setTimeout(() => setShowEmailModal(false), 1400);
    } catch (err: any) {
      setEmailDeliveryStatus({
        status: 'FAILED',
        error: err.message || 'Email delivery failed.',
        recipientEmail: target,
      });
      setError(err.message || 'Email delivery failed.');
    } finally {
      setSendingEmail(false);
    }
  }

  // 5. Retry Telegram Delivery (Automatic via Family Service)
  async function retryTelegramDelivery() {
    if (!prescription) return;
    setSendingTelegram(true);
    setError('');
    try {
      const res = await post<any>(`/prescriptions/${prescription.id}/retry-telegram`, {});
      if (res.telegramDelivery) {
        setTelegramDeliveryStatus(res.telegramDelivery);
      }
      if (res.success) {
        setSuccessMsg('Prescription successfully delivered to patient Telegram!');
      }
    } catch (err: any) {
      setError(err.message || 'Retry Telegram delivery failed.');
      if (err.data?.telegramDelivery) {
        setTelegramDeliveryStatus(err.data.telegramDelivery);
      }
      setRecipientPhone(patient?.phone || '');
      setShowTelegramModal(true);
    } finally {
      setSendingTelegram(false);
    }
  }

  // 5. Telegram Recipient Verification
  async function verifyRecipientPhone(phoneToVerify: string) {
    if (!prescription) return;
    if (!phoneToVerify || phoneToVerify.trim().length < 7) {
      setRecipientVerification({
        matched: false,
        message: 'Please enter a valid phone number with at least 7 digits.',
      });
      return;
    }

    setVerifyingRecipient(true);
    try {
      const res = await post<any>(`/prescriptions/${prescription.id}/verify-recipient`, {
        phone: phoneToVerify.trim(),
      });
      setRecipientVerification(res);
    } catch (err: any) {
      setRecipientVerification({
        matched: false,
        message: err.message || 'Could not verify recipient phone.',
      });
    } finally {
      setVerifyingRecipient(false);
    }
  }

  // 6. Send via Telegram
  async function sendViaTelegram() {
    if (!prescription) return;
    setSendingTelegram(true);
    setError('');
    try {
      const res = await post<any>(`/prescriptions/${prescription.id}/send-telegram`, {
        phone: recipientPhone.trim(),
      });
      setTelegramDeliveryStatus(res.telegramDelivery || { status: 'SENT', sentAt: new Date().toISOString() });
      setSuccessMsg('Prescription delivered directly to the patient via Telegram!');
      setTimeout(() => setShowTelegramModal(false), 1400);
    } catch (err: any) {
      setTelegramDeliveryStatus({
        status: 'FAILED',
        error: err.message || 'Delivery failed.',
      });
    } finally {
      setSendingTelegram(false);
    }
  }

  // 7. Print Prescription Helper
  async function printPrescription() {
    if (!prescription) return;
    try {
      const blobUrl = await getFileBlobUrl(prescription.downloadUrl);
      const printWindow = window.open(blobUrl, '_blank');
      if (printWindow) {
        printWindow.focus();
        printWindow.print();
      }
    } catch (err: any) {
      setError(err.message || 'Unable to print prescription.');
    }
  }

  // 8. Clinical Reference Query (RAG)
  async function askClinicalReferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setAnswer('');
    setSources([]);
    try {
      const result = await post<{
        answer: string;
        sources: { source: string; excerpt: string }[];
      }>('/ai/rag/query', { question: question.trim() });
      setAnswer(result.answer);
      setSources(result.sources || []);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Clinical reference retrieval is unavailable.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading-panel">Loading patient & consultation data…</div>;

  return (
    <>
      {/* 1. Patient & Consultation Header */}
      <div className="pagehead">
        <div>
          <div className="eyebrow">DOCTOR WORKSPACE · ACTIVE CONSULTATION</div>
          <h1>{patient?.name || queue?.patientName || 'Patient Consultation'}</h1>
          <p>
            {patient && (
              <span>
                <b>Age:</b> {patient.age} yrs • <b>Gender:</b> {patient.gender} • <b>Phone:</b>{' '}
                {patient.phone} • <b>ID:</b> {patient.id.slice(0, 10)}
              </span>
            )}
            {queue?.tokenNumber && queue.tokenNumber !== '—' && (
              <span> | Token: <b>{queue.tokenNumber}</b> ({queue.priority})</span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Badge tone={consultation ? 'normal' : 'senior'}>
            {consultation ? 'CONSULTATION RECORDED' : 'IN CONSULTATION'}
          </Badge>
          <Button
            variant="primary"
            disabled={callingNextPatient}
            onClick={() => void callNextPatient()}
            title="Call the next patient in line"
          >
            {callingNextPatient ? 'Calling…' : '📢 Call Next Patient'}
          </Button>
          <Button variant="secondary" onClick={() => navigate('/queue')}>
            ← Queue
          </Button>
        </div>
      </div>

      {error && (
        <div className="error page-error" role="alert" style={{ marginBottom: '16px' }}>
          {error}
        </div>
      )}
      {successMsg && (
        <div className="success" role="status" style={{ marginBottom: '16px', padding: '12px' }}>
          {successMsg}
        </div>
      )}

      {/* 2. Medical History Toggle Banner */}
      {pastConsultations.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <Button variant="secondary" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? 'Hide' : 'View'} Past Consultation History ({pastConsultations.length} previous visits)
          </Button>
          {showHistory && (
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {pastConsultations.map((c) => (
                <Card key={c.id} title={`Visit on ${c.createdAt ? c.createdAt.split('T')[0] : 'Past Visit'} · Dr. ${c.doctorName}`}>
                  <p><b>Diagnosis:</b> {c.diagnosis}</p>
                  {c.notes && <p style={{ color: '#475569' }}><b>Notes:</b> {c.notes}</p>}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. Main Workflow: Consultation Details */}
      <div className="grid2">
        <Card title={consultation ? 'Consultation Record' : 'Record Clinical Diagnosis'}>
          {consultation ? (
            <div className="patient-detail">
              <div style={{ marginBottom: '12px' }}>
                <small style={{ color: '#64748b', fontWeight: 600 }}>DIAGNOSIS</small>
                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#0f172a' }}>
                  {consultation.diagnosis}
                </div>
              </div>
              {consultation.notes && (
                <div style={{ marginBottom: '12px' }}>
                  <small style={{ color: '#64748b', fontWeight: 600 }}>CLINICAL NOTES</small>
                  <p style={{ margin: '4px 0', color: '#334155' }}>{consultation.notes}</p>
                </div>
              )}
              <small style={{ color: '#64748b' }}>
                Recorded {new Date(consultation.createdAt).toLocaleString()} by Dr. {consultation.doctorName}
              </small>
            </div>
          ) : (
            <form className="form-grid" onSubmit={saveConsultation}>
              <label className="full">
                Clinical Diagnosis *
                <input
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  placeholder="e.g. Acute Upper Respiratory Tract Infection"
                  maxLength={500}
                  required
                />
              </label>
              <label className="full">
                Clinical Notes / Symptoms / Observations
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Cough for 3 days, mild fever, throat congestion. BP 120/80."
                  rows={4}
                  maxLength={5000}
                />
              </label>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save Consultation Record'}
              </Button>
            </form>
          )}
        </Card>

        {/* Clinical Reference Search (RAG) */}
        <Card title="Clinical Reference & Drug Index (RAG)">
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Query hospital-indexed clinical guidelines, drug interactions, and medical directories.
          </p>
          <form className="form-grid" onSubmit={askClinicalReferences}>
            <label className="full">
              Clinical Question
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. First-line antibiotic dosage for acute bacterial pharyngitis"
                rows={2}
                maxLength={1000}
                required
              />
            </label>
            <Button type="submit" variant="secondary" disabled={saving}>
              {saving ? 'Searching…' : 'Search Clinical Reference'}
            </Button>
          </form>
          {answer && (
            <div className="rag-answer" style={{ marginTop: '14px' }}>
              <h4>Retrieved Guidance:</h4>
              <p style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>{answer}</p>
              {sources.length > 0 && (
                <div style={{ marginTop: '8px' }}>
                  <small style={{ fontWeight: 600, color: '#64748b' }}>Verified Sources:</small>
                  {sources.map((s, idx) => (
                    <details key={idx} style={{ fontSize: '0.8rem', marginTop: '4px' }}>
                      <summary>{s.source}</summary>
                      <p>{s.excerpt}</p>
                    </details>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* 4. Prescription Creation & Management (Enabled once consultation is saved) */}
      <div style={{ marginTop: '24px' }}>
        <Card title="Prescription & Medication Table (Rx)">
          {!consultation ? (
            <div className="empty" style={{ padding: '24px' }}>
              Complete and save the consultation diagnosis above to unlock the prescription builder.
            </div>
          ) : prescription ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="success" role="status" style={{ padding: '12px' }}>
                ✅ Prescription <b>#{prescription.id.slice(0, 10)}</b> has been generated as a formal A4 document.
              </div>

              {/* Prescription Summary Table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
                      <th style={{ padding: '8px' }}>#</th>
                      <th style={{ padding: '8px' }}>Medication</th>
                      <th style={{ padding: '8px' }}>Dosage</th>
                      <th style={{ padding: '8px' }}>Frequency</th>
                      <th style={{ padding: '8px' }}>Duration</th>
                      <th style={{ padding: '8px' }}>Instructions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(prescription.medications || medications).map((m, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '8px' }}>{idx + 1}</td>
                        <td style={{ padding: '8px', fontWeight: 600 }}>{m.name}</td>
                        <td style={{ padding: '8px' }}>{m.dosage}</td>
                        <td style={{ padding: '8px' }}>{m.frequency || '1-0-1'}</td>
                        <td style={{ padding: '8px' }}>{m.duration}</td>
                        <td style={{ padding: '8px' }}>{m.instructions || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {prescription.instructions && (
                <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '6px' }}>
                  <b>Advice & General Instructions:</b> {prescription.instructions}
                </div>
              )}
              {prescription.followUpDate && (
                <div style={{ background: '#eff6ff', padding: '10px 12px', borderRadius: '6px', color: '#1d4ed8' }}>
                  <b>Follow-up Recommendation:</b> {prescription.followUpDate}
                </div>
              )}

              {/* Delivery Channels Status Badges */}
              <div style={{ display: 'grid', gap: '8px', marginTop: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', minWidth: '130px' }}>
                    📱 Telegram Channel:
                  </span>
                  {telegramDeliveryStatus?.status === 'SENT' ? (
                    <Badge tone="normal">
                      ✅ DELIVERED {telegramDeliveryStatus.sentAt ? `(${new Date(telegramDeliveryStatus.sentAt).toLocaleTimeString()})` : ''}
                    </Badge>
                  ) : telegramDeliveryStatus?.status === 'FAILED' ? (
                    <Badge tone="emergency">❌ FAILED: {telegramDeliveryStatus.error}</Badge>
                  ) : telegramDeliveryStatus?.status === 'TELEGRAM_NOT_CONFIGURED' ? (
                    <Badge tone="senior">⚠️ NOT LINKED (Patient not on Telegram)</Badge>
                  ) : telegramDeliveryStatus?.status === 'NOT_LINKED' ? (
                    <Badge tone="senior">⚠️ NOT LINKED</Badge>
                  ) : (
                    <Badge tone="senior">PENDING</Badge>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', minWidth: '130px' }}>
                    ✉️ Email Delivery:
                  </span>
                  {emailDeliveryStatus?.status === 'SENT' ? (
                    <Badge tone="normal">
                      ✅ DELIVERED to {emailDeliveryStatus.recipientEmail || recipientEmail} {emailDeliveryStatus.sentAt ? `(${new Date(emailDeliveryStatus.sentAt).toLocaleTimeString()})` : ''}
                    </Badge>
                  ) : emailDeliveryStatus?.status === 'FAILED' ? (
                    <Badge tone="emergency">❌ FAILED: {emailDeliveryStatus.error}</Badge>
                  ) : emailDeliveryStatus?.status === 'PENDING' ? (
                    <Badge tone="senior">⏳ TRANSMITTING…</Badge>
                  ) : (
                    <Badge tone="neutral">⚠️ NOT SENT (Ready to deliver)</Badge>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '14px' }}>
                <Button
                  onClick={() =>
                    void downloadFile(
                      prescription.downloadUrl,
                      `prescription-${prescription.id}.pdf`,
                    ).catch((err) => setError(err.message))
                  }
                >
                  📥 Download PDF
                </Button>
                <Button variant="secondary" onClick={() => void printPrescription()}>
                  🖨️ Print
                </Button>
                <Button
                  variant="secondary"
                  disabled={sendingEmail}
                  onClick={() => {
                    setRecipientEmail(patient?.email || recipientEmail || '');
                    setShowEmailModal(true);
                  }}
                  style={{
                    background: emailDeliveryStatus?.status === 'SENT' ? '#f8fafc' : '#f0fdfa',
                    borderColor: '#0f766e',
                    color: '#0f766e',
                    fontWeight: 600,
                  }}
                >
                  {sendingEmail
                    ? 'Delivering Email…'
                    : emailDeliveryStatus?.status === 'SENT'
                    ? '🔄 Resend via Email'
                    : '✉️ Send via Email'}
                </Button>
                <Button
                  variant="secondary"
                  disabled={sendingTelegram}
                  onClick={() => {
                    if (telegramDeliveryStatus?.status === 'SENT') {
                      void retryTelegramDelivery();
                    } else {
                      setRecipientPhone(patient?.phone || '');
                      setShowTelegramModal(true);
                    }
                  }}
                >
                  {sendingTelegram
                    ? 'Delivering…'
                    : telegramDeliveryStatus?.status === 'SENT'
                    ? '🔄 Resend via Telegram'
                    : '📱 Send via Telegram'}
                </Button>
                <Button
                  variant="primary"
                  disabled={callingNextPatient}
                  onClick={() => void callNextPatient()}
                  title="Finish and call the next patient in queue"
                  style={{
                    marginLeft: 'auto',
                    fontWeight: 600,
                  }}
                >
                  {callingNextPatient ? 'Calling Next Patient…' : '📢 Call Next Patient →'}
                </Button>
              </div>
            </div>
          ) : (
            /* Prescription Creation Form */
            <form onSubmit={savePrescription} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p style={{ color: '#475569', fontSize: '0.9rem', margin: 0 }}>
                Specify medications, dosage, frequency, and instructions. The doctor remains solely responsible for medical accuracy.
              </p>

              {/* Dynamic Medication Rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {medications.map((m, index) => (
                  <div
                    key={index}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1.5fr auto',
                      gap: '8px',
                      alignItems: 'end',
                      background: '#f8fafc',
                      padding: '12px',
                      borderRadius: '6px',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <label style={{ margin: 0 }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Medicine Name *</span>
                      <input
                        value={m.name}
                        onChange={(e) => updateMedication(index, 'name', e.target.value)}
                        placeholder="e.g. Amoxicillin"
                        required
                      />
                    </label>
                    <label style={{ margin: 0 }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Dosage *</span>
                      <input
                        value={m.dosage}
                        onChange={(e) => updateMedication(index, 'dosage', e.target.value)}
                        placeholder="e.g. 500 mg"
                        required
                      />
                    </label>
                    <label style={{ margin: 0 }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Frequency</span>
                      <input
                        value={m.frequency}
                        onChange={(e) => updateMedication(index, 'frequency', e.target.value)}
                        placeholder="e.g. 1-0-1"
                      />
                    </label>
                    <label style={{ margin: 0 }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Duration *</span>
                      <input
                        value={m.duration}
                        onChange={(e) => updateMedication(index, 'duration', e.target.value)}
                        placeholder="e.g. 5 days"
                        required
                      />
                    </label>
                    <label style={{ margin: 0 }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Special Instructions</span>
                      <input
                        value={m.instructions}
                        onChange={(e) => updateMedication(index, 'instructions', e.target.value)}
                        placeholder="e.g. After meals"
                      />
                    </label>
                    {medications.length > 1 && (
                      <button
                        type="button"
                        className="link"
                        style={{ color: '#dc2626', padding: '8px 4px', height: '38px' }}
                        onClick={() => removeMedication(index)}
                      >
                        ✕ Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div>
                <Button type="button" variant="secondary" onClick={addMedication}>
                  + Add Medication Row
                </Button>
              </div>

              <div className="grid2" style={{ marginTop: '8px' }}>
                <label className="full">
                  General Instructions / Dietary Advice
                  <textarea
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="e.g. Drink warm fluids, avoid cold beverages, adequate bed rest."
                    rows={3}
                  />
                </label>
                <label className="full">
                  Follow-up Advice / Date
                  <input
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    placeholder="e.g. 5 days (or sooner if fever does not subside)"
                  />
                </label>
              </div>

              <div style={{ marginTop: '12px' }}>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Generating PDF…' : 'Save Prescription & Generate PDF'}
                </Button>
              </div>
            </form>
          )}
        </Card>
      </div>

      {/* 5. Modal: Send Prescription to Patient (Telegram) */}
      {showTelegramModal && prescription && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '520px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: '1.25rem', color: '#0f172a' }}>
              Send Prescription to Patient
            </h2>
            <p style={{ color: '#475569', fontSize: '0.9rem' }}>
              Confirm the patient's phone number to deliver their official prescription via the clinic's verified Telegram bot.
            </p>

            <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>
              <div><b>Patient:</b> {patient?.name || prescription.patientName}</div>
              <div><b>Registered Phone:</b> {patient?.phone || 'Not on file'}</div>
              <div style={{ marginTop: '4px' }}>
                <b>Telegram Status:</b>{' '}
                {recipientVerification?.isLinked ? (
                  <span style={{ color: '#16a34a', fontWeight: 600 }}>Linked & Ready</span>
                ) : (
                  <span style={{ color: '#d97706', fontWeight: 600 }}>Not Linked</span>
                )}
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                Verify Recipient Phone Number
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  style={{ flex: 1 }}
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value)}
                  placeholder="e.g. +91 98765 43210"
                />
                <Button
                  variant="secondary"
                  disabled={verifyingRecipient}
                  onClick={() => void verifyRecipientPhone(recipientPhone)}
                >
                  {verifyingRecipient ? 'Checking…' : 'Verify'}
                </Button>
              </div>
            </div>

            {/* Recipient verification feedback */}
            {recipientVerification && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  marginBottom: '16px',
                  fontSize: '0.88rem',
                  background: recipientVerification.isLinked ? '#f0fdf4' : '#fffbeb',
                  border: `1px solid ${recipientVerification.isLinked ? '#86efac' : '#fde68a'}`,
                  color: recipientVerification.isLinked ? '#166534' : '#92400e',
                }}
              >
                {recipientVerification.message}
              </div>
            )}

            {/* Telegram delivery result feedback */}
            {telegramDeliveryStatus && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  marginBottom: '16px',
                  fontSize: '0.88rem',
                  background: telegramDeliveryStatus.status === 'SENT' ? '#f0fdf4' : '#fef2f2',
                  border: `1px solid ${telegramDeliveryStatus.status === 'SENT' ? '#86efac' : '#fca5a5'}`,
                  color: telegramDeliveryStatus.status === 'SENT' ? '#166534' : '#991b1b',
                }}
              >
                {telegramDeliveryStatus.status === 'SENT' ? (
                  <div>
                    ✅ <b>Prescription Delivered!</b> Sent on{' '}
                    {new Date(telegramDeliveryStatus.sentAt || Date.now()).toLocaleTimeString()} to verified recipient.
                  </div>
                ) : (
                  <div>
                    ⚠️ <b>Delivery Failed:</b> {telegramDeliveryStatus.error}
                  </div>
                )}
              </div>
            )}

            {/* Quick Switch to Email Delivery if Telegram is not linked or failed */}
            {(!recipientVerification?.isLinked || telegramDeliveryStatus?.status === 'FAILED') && (
              <div
                style={{
                  background: '#f0fdfa',
                  border: '1px solid #99f6e4',
                  borderRadius: '6px',
                  padding: '12px',
                  marginBottom: '16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '10px',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0f766e' }}>
                    💡 Prefer sending via Patient Email?
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#134e4a' }}>
                    Patients registered by receptionist can receive the complete prescription PDF directly by email.
                  </div>
                </div>
                <Button
                  variant="primary"
                  onClick={() => {
                    setShowTelegramModal(false);
                    setRecipientEmail(patient?.email || '');
                    setShowEmailModal(true);
                  }}
                  style={{ whiteSpace: 'nowrap', fontSize: '0.82rem', padding: '6px 12px' }}
                >
                  ✉️ Send via Email
                </Button>
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
              <Button variant="secondary" onClick={() => setShowTelegramModal(false)}>
                Skip for Now
              </Button>
              {telegramDeliveryStatus?.status === 'FAILED' ? (
                <Button disabled={sendingTelegram} onClick={() => void sendViaTelegram()}>
                  {sendingTelegram ? 'Retrying…' : 'Retry Sending'}
                </Button>
              ) : (
                <Button
                  disabled={sendingTelegram || !recipientPhone.trim()}
                  onClick={() => void sendViaTelegram()}
                >
                  {sendingTelegram ? 'Sending…' : 'Send via Telegram'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* EMAIL DELIVERY MODAL */}
      {showEmailModal && prescription && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '10px',
              padding: '24px',
              maxWidth: '540px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#0f172a' }}>
                ✉️ Deliver Prescription via Email
              </h2>
              <button
                type="button"
                className="btn-icon"
                onClick={() => setShowEmailModal(false)}
                style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: '16px' }}
              >
                ✕
              </button>
            </div>

            <p style={{ color: '#475569', fontSize: '0.88rem', marginTop: 0, marginBottom: '16px' }}>
              Send this official prescription directly to the patient's inbox. The email includes consultation context from the attending doctor, full medication schedule, and the digitally verified PDF attachment.
            </p>

            {/* Email Context Summary Box */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '14px',
                marginBottom: '16px',
                fontSize: '0.85rem',
                display: 'grid',
                gap: '6px',
              }}
            >
              <div>
                <span style={{ color: '#64748b' }}>Attending Physician: </span>
                <b style={{ color: '#0f172a' }}>Dr. {prescription.doctorName} ({prescription.doctorSpecialization || 'General Physician'})</b>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Hospital / Health Center: </span>
                <b style={{ color: '#0f766e' }}>ClinicQueue Healthcare System</b>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Patient: </span>
                <b style={{ color: '#0f172a' }}>{patient?.name || prescription.patientName}</b>
                {patient?.age ? <span style={{ color: '#64748b' }}> ({patient.age} yrs, {patient.gender})</span> : null}
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Clinical Diagnosis: </span>
                <b style={{ color: '#1e3a8a' }}>{prescription.diagnosis || diagnosis || 'Clinical Consultation'}</b>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Attachment: </span>
                <span style={{ color: '#0f766e', fontWeight: 600 }}>📎 {prescription.fileName} (Official Verified PDF)</span>
              </div>
            </div>

            {/* Recipient Email Input */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', color: '#1e293b' }}>
                Recipient Email Address *
              </label>
              <input
                type="email"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.9rem',
                }}
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="e.g. patient@example.com"
                required
              />
              <span style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
                You can ask and confirm the patient's email address right at the desk.
              </span>
            </div>

            {/* Delivery Feedback */}
            {emailDeliveryStatus && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  marginBottom: '16px',
                  fontSize: '0.88rem',
                  background: emailDeliveryStatus.status === 'SENT' ? '#f0fdf4' : '#fef2f2',
                  border: `1px solid ${emailDeliveryStatus.status === 'SENT' ? '#86efac' : '#fca5a5'}`,
                  color: emailDeliveryStatus.status === 'SENT' ? '#166534' : '#991b1b',
                }}
              >
                {emailDeliveryStatus.status === 'SENT' ? (
                  <div>
                    ✅ <b>Prescription Delivered!</b> Sent on{' '}
                    {new Date(emailDeliveryStatus.sentAt || Date.now()).toLocaleTimeString()} to{' '}
                    <b>{emailDeliveryStatus.recipientEmail || recipientEmail}</b> with verified PDF attached.
                  </div>
                ) : (
                  <div>
                    ⚠️ <b>Delivery Failed:</b> {emailDeliveryStatus.error}
                  </div>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
              <Button variant="secondary" onClick={() => setShowEmailModal(false)}>
                Close
              </Button>
              <Button
                disabled={sendingEmail || !recipientEmail.trim()}
                onClick={() => void sendViaEmail()}
              >
                {sendingEmail ? 'Delivering Email…' : '✉️ Send Prescription to Email'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
