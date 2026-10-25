import { FormEvent, useEffect, useState } from 'react';
import { Card, Button } from '../components/Ui';
import { useAuth } from '../context/AuthContext';
import { api, get, post } from '../services/api';
import type { Role } from '../types';

type FaqDocument = {
  document_id: string;
  filename: string;
  uploaded_at: string;
  chunks_indexed: number;
};

export default function Settings() {
  const { profile, reloadProfile } = useAuth();
  const [onDuty, setOnDuty] = useState(Boolean(profile?.onDuty));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [faqDocuments, setFaqDocuments] = useState<FaqDocument[]>([]);
  const [faqLoading, setFaqLoading] = useState(false);
  const [faqUploading, setFaqUploading] = useState(false);
  const [syncingKnowledge, setSyncingKnowledge] = useState(false);

  // Doctor profile upload form
  const [doctorForm, setDoctorForm] = useState({
    doctorName: '',
    specialization: 'General Physician',
    timings: 'Monday to Saturday: 09:00 AM - 01:00 PM',
    fee: '$40',
    room: 'Cabin 101, Ground Floor',
    qualifications: 'MBBS, MD',
    experience: '10 Years',
    bio: '',
  });

  // AI test query state
  const [testQuestion, setTestQuestion] = useState('Where is the clinic located?');
  const [testAnswer, setTestAnswer] = useState('');
  const [testingAi, setTestingAi] = useState(false);

  const [account, setAccount] = useState({
    name: '',
    email: '',
    password: '',
    role: 'RECEPTIONIST' as Role,
    active: true,
    specialization: 'General Physician',
    room: 'Cabin 101, Ground Floor',
    fee: '$40',
    useExistingUid: false,
    uid: '',
  });

  const loadDocuments = () => {
    setFaqLoading(true);
    get<{ documents: FaqDocument[] }>('/admin/rag/documents')
      .then((result) => setFaqDocuments(result.documents))
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : 'Unable to load FAQ documents.'),
      )
      .finally(() => setFaqLoading(false));
  };

  useEffect(() => {
    if (profile?.role !== 'ADMIN') return;
    loadDocuments();
  }, [profile?.role]);

  async function setAvailability() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await post('/me/availability', { onDuty: !onDuty });
      setOnDuty(!onDuty);
      setNotice('Doctor availability updated.');
      await reloadProfile();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update availability.');
    } finally {
      setSaving(false);
    }
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload: any = {
        name: account.name.trim(),
        email: account.email.trim(),
        role: account.role,
        active: account.active,
      };

      if (account.useExistingUid) {
        if (!account.uid.trim()) {
          throw new Error('Please enter the Firebase UID or uncheck existing UID mode.');
        }
        payload.uid = account.uid.trim();
      } else {
        if (!account.password || account.password.length < 6) {
          throw new Error('Password must be at least 6 characters.');
        }
        payload.password = account.password;
      }

      if (account.role === 'DOCTOR') {
        payload.specialization = account.specialization;
        payload.room = account.room;
        payload.fee = account.fee;
      }

      const res = await post<any>('/admin/users', payload);
      setNotice(`✅ Account created & role assigned for ${account.email} (UID: ${res.uid})! User can log in immediately.`);
      setAccount({
        name: '',
        email: '',
        password: '',
        role: 'RECEPTIONIST',
        active: true,
        specialization: 'General Physician',
        room: 'Cabin 101, Ground Floor',
        fee: '$40',
        useExistingUid: false,
        uid: '',
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save user account.');
    } finally {
      setSaving(false);
    }
  }

  async function uploadFaqDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setFaqUploading(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ filename: string; chunks_indexed: number }>(
        '/admin/rag/ingest',
        { method: 'POST', body: new FormData(form) },
      );
      setNotice(`Indexed ${result.filename} (${result.chunks_indexed} sections).`);
      loadDocuments();
      form.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to index FAQ document.');
    } finally {
      setFaqUploading(false);
    }
  }

  async function syncAllKnowledge() {
    setSyncingKnowledge(true);
    setError('');
    setNotice('');
    try {
      const res = await post<{ message: string; indexed_documents: any[] }>('/admin/rag/sync-knowledge', {});
      setNotice(res.message || 'Hospital information & doctor directory synced to AI RAG!');
      loadDocuments();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sync knowledge base.');
    } finally {
      setSyncingKnowledge(false);
    }
  }

  async function saveDoctorProfileToRag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await post('/admin/rag/doctor-profile', doctorForm);
      setNotice(`Doctor profile for Dr. ${doctorForm.doctorName} uploaded and indexed into AI RAG!`);
      loadDocuments();
      setDoctorForm({
        doctorName: '',
        specialization: 'General Physician',
        timings: 'Monday to Saturday: 09:00 AM - 01:00 PM',
        fee: '$40',
        room: 'Cabin 101, Ground Floor',
        qualifications: 'MBBS, MD',
        experience: '10 Years',
        bio: '',
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to upload doctor profile.');
    } finally {
      setSaving(false);
    }
  }

  async function testRagQuery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTestingAi(true);
    setTestAnswer('');
    try {
      const res = await post<{ answer: string }>('/ai/rag/query', { question: testQuestion });
      setTestAnswer(res.answer || 'No answer returned.');
    } catch (reason) {
      setTestAnswer(reason instanceof Error ? reason.message : 'Failed to query AI service.');
    } finally {
      setTestingAi(false);
    }
  }

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">PROFILE & SETTINGS</div>
          <h1>Workspace settings</h1>
          <p>Account identity, access roles, hospital knowledge base (RAG), and clinic availability.</p>
        </div>
      </div>

      {error && <div className="error page-error" role="alert">{error}</div>}
      {notice && <div className="success page-error" role="status">{notice}</div>}

      <div className="grid2">
        <Card title="Your account">
          <div className="profile">
            <div className="avatar big">{profile?.name?.[0] || 'C'}</div>
            <h3>{profile?.name}</h3>
            <p>{profile?.email}</p>
            <span className="role-pill">{profile?.role}</span>
          </div>
        </Card>

        {profile?.role === 'DOCTOR' && (
          <Card title="Doctor availability">
            <p className="muted">
              On-duty status is shown on the operations dashboard.
            </p>
            <Button disabled={saving} onClick={() => void setAvailability()}>
              {saving
                ? 'Saving…'
                : onDuty
                  ? 'Mark unavailable'
                  : 'Mark on duty'}
            </Button>
          </Card>
        )}

        {profile?.role === 'ADMIN' && (
          <Card title="Add Clinic User & Assign Role">
            <p className="muted">
              Create a new clinic user (Admin, Doctor, or Receptionist) directly with their email and password. The system will automatically create their Firebase Authentication credentials and assign their workspace permissions.
            </p>
            <form className="form-grid" onSubmit={saveAccount}>
              <label>
                Full Name *
                <input
                  placeholder="e.g. Dr. Rajesh Sharma / Receptionist Staff"
                  value={account.name}
                  onChange={(event) =>
                    setAccount({ ...account, name: event.target.value })
                  }
                  minLength={2}
                  maxLength={120}
                  required
                />
              </label>

              <label>
                Email Address *
                <input
                  type="email"
                  placeholder="e.g. staff@clinicqueue.health"
                  value={account.email}
                  onChange={(event) =>
                    setAccount({ ...account, email: event.target.value })
                  }
                  required
                />
              </label>

              {!account.useExistingUid ? (
                <label>
                  Login Password *
                  <input
                    type="password"
                    placeholder="Min 6 characters (e.g. Staff@123)"
                    value={account.password}
                    onChange={(event) =>
                      setAccount({ ...account, password: event.target.value })
                    }
                    minLength={6}
                    required
                  />
                </label>
              ) : (
                <label>
                  Firebase UID *
                  <input
                    placeholder="Firebase Auth UID"
                    value={account.uid}
                    onChange={(event) =>
                      setAccount({ ...account, uid: event.target.value })
                    }
                    minLength={1}
                    maxLength={128}
                    required
                  />
                </label>
              )}

              <label>
                Clinic Role *
                <select
                  value={account.role}
                  onChange={(event) =>
                    setAccount({ ...account, role: event.target.value as Role })
                  }
                >
                  <option value="RECEPTIONIST">Receptionist</option>
                  <option value="DOCTOR">Doctor</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </label>

              {account.role === 'DOCTOR' && (
                <>
                  <label>
                    Medical Specialization
                    <input
                      placeholder="e.g. General Physician / Cardiologist"
                      value={account.specialization}
                      onChange={(event) =>
                        setAccount({ ...account, specialization: event.target.value })
                      }
                    />
                  </label>

                  <label>
                    Consultation Room / Cabin
                    <input
                      placeholder="e.g. Cabin 101, Ground Floor"
                      value={account.room}
                      onChange={(event) =>
                        setAccount({ ...account, room: event.target.value })
                      }
                    />
                  </label>
                </>
              )}

              <label>
                Account Access
                <select
                  value={account.active ? 'active' : 'inactive'}
                  onChange={(event) =>
                    setAccount({
                      ...account,
                      active: event.target.value === 'active',
                    })
                  }
                >
                  <option value="active">Active (Access Granted)</option>
                  <option value="inactive">Inactive (Disabled)</option>
                </select>
              </label>

              <div className="full" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <input
                  type="checkbox"
                  id="useExistingUid"
                  checked={account.useExistingUid}
                  onChange={(e) => setAccount({ ...account, useExistingUid: e.target.checked })}
                />
                <label htmlFor="useExistingUid" style={{ margin: 0, fontSize: '0.85rem', color: '#64748b', cursor: 'pointer' }}>
                  Advanced: Map existing Firebase UID manually instead of creating credentials
                </label>
              </div>

              <div className="full" style={{ marginTop: '8px' }}>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Creating User…' : '✨ Create User & Save Role'}
                </Button>
              </div>
            </form>
          </Card>
        )}

        {profile?.role === 'ADMIN' && (
          <Card title="Hospital & Doctor AI Knowledge Base (RAG)">
            <p className="muted">
              Sync complete hospital information and doctor profiles into the AI service. When patients ask on Telegram or the website, the AI retrieves these details.
            </p>

            <div style={{ margin: '1rem 0', padding: '1rem', background: 'var(--surface-sunken, #f8fafc)', borderRadius: '8px', border: '1px solid var(--border, #e2e8f0)' }}>
              <h4 style={{ margin: '0 0 0.5rem 0' }}>⚡ One-Click Knowledge Sync</h4>
              <p className="muted" style={{ margin: '0 0 1rem 0', fontSize: '0.9rem' }}>
                Automatically indexes <strong>hospital_information.md</strong> (services, timings, fees, emergency, location) and <strong>doctors_directory.md</strong> (all doctor profiles, qualifications, schedules).
              </p>
              <Button type="button" disabled={syncingKnowledge} onClick={() => void syncAllKnowledge()}>
                {syncingKnowledge ? 'Syncing Knowledge…' : '🏥 Sync Hospital & Doctor Directory'}
              </Button>
            </div>

            <h4 style={{ margin: '1.5rem 0 0.5rem 0' }}>📤 Upload Custom Document</h4>
            <form className="form-grid" onSubmit={uploadFaqDocument}>
              <label className="full">
                Document File (.pdf, .txt, .md)
                <input
                  name="file"
                  type="file"
                  accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
                  required
                />
              </label>
              <Button type="submit" disabled={faqUploading}>
                {faqUploading ? 'Indexing…' : 'Upload custom document'}
              </Button>
            </form>

            <h4 style={{ margin: '1.5rem 0 0.5rem 0' }}>📚 Currently Indexed Documents</h4>
            <div className="visit-list" aria-live="polite">
              {faqLoading ? (
                <p className="muted">Loading indexed files…</p>
              ) : faqDocuments.length ? (
                faqDocuments.map((document) => (
                  <div className="visit" key={document.document_id}>
                    <strong>{document.filename}</strong>
                    <span className="muted">{document.chunks_indexed} sections</span>
                  </div>
                ))
              ) : (
                <p className="muted">No information files indexed yet. Click Sync above!</p>
              )}
            </div>
          </Card>
        )}

        {profile?.role === 'ADMIN' && (
          <Card title="Add / Update Doctor Profile in AI RAG">
            <p className="muted">
              Upload detailed information about an individual doctor so patients can ask about their schedule, qualifications, and consultation fees.
            </p>
            <form className="form-grid" onSubmit={saveDoctorProfileToRag}>
              <label>
                Doctor Name
                <input
                  placeholder="e.g. Priya Patel"
                  value={doctorForm.doctorName}
                  onChange={(e) => setDoctorForm({ ...doctorForm, doctorName: e.target.value })}
                  required
                />
              </label>
              <label>
                Specialization
                <input
                  placeholder="e.g. Cardiologist"
                  value={doctorForm.specialization}
                  onChange={(e) => setDoctorForm({ ...doctorForm, specialization: e.target.value })}
                  required
                />
              </label>
              <label>
                Consultation Timings
                <input
                  placeholder="e.g. Mon-Fri: 10:00 AM - 02:00 PM"
                  value={doctorForm.timings}
                  onChange={(e) => setDoctorForm({ ...doctorForm, timings: e.target.value })}
                  required
                />
              </label>
              <label>
                Consultation Fee
                <input
                  placeholder="e.g. $60"
                  value={doctorForm.fee}
                  onChange={(e) => setDoctorForm({ ...doctorForm, fee: e.target.value })}
                  required
                />
              </label>
              <label>
                Room / Cabin
                <input
                  placeholder="e.g. Cabin 204, 2nd Floor"
                  value={doctorForm.room}
                  onChange={(e) => setDoctorForm({ ...doctorForm, room: e.target.value })}
                  required
                />
              </label>
              <label>
                Qualifications & Degrees
                <input
                  placeholder="e.g. MBBS, MD (Cardiology)"
                  value={doctorForm.qualifications}
                  onChange={(e) => setDoctorForm({ ...doctorForm, qualifications: e.target.value })}
                  required
                />
              </label>
              <label className="full">
                Bio & Conditions Treated
                <textarea
                  rows={2}
                  placeholder="e.g. High blood pressure, heart disease, 2D Echo, preventive cardiology."
                  value={doctorForm.bio}
                  onChange={(e) => setDoctorForm({ ...doctorForm, bio: e.target.value })}
                />
              </label>
              <Button type="submit" disabled={saving}>
                {saving ? 'Indexing Profile…' : '👨‍⚕️ Upload Doctor Profile to AI'}
              </Button>
            </form>
          </Card>
        )}

        {(profile?.role === 'ADMIN' || profile?.role === 'DOCTOR') && (
          <Card title="🧪 Test AI RAG FAQ Search">
            <p className="muted">
              Ask questions to preview the AI's properly formatted answers as patients will see them on Telegram and the web.
            </p>
            <form className="form-grid" onSubmit={testRagQuery}>
              <label className="full">
                Test Question
                <input
                  value={testQuestion}
                  onChange={(e) => setTestQuestion(e.target.value)}
                  placeholder="e.g. Where is the clinic located? / Who is Dr. Priya Patel?"
                  required
                />
              </label>
              <Button type="submit" disabled={testingAi}>
                {testingAi ? 'Searching AI…' : '🔍 Ask AI Assistant'}
              </Button>
            </form>

            {testAnswer && (
              <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--surface-sunken, #f1f5f9)', borderRadius: '8px', borderLeft: '4px solid var(--accent, #3b82f6)' }}>
                <strong>🤖 AI Response:</strong>
                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '0.5rem 0 0 0', fontSize: '0.95rem' }}>
                  {testAnswer}
                </pre>
              </div>
            )}
          </Card>
        )}

        <Card title="System Architecture">
          <p className="muted"><strong>Backend:</strong> Node.js + TypeScript (Express)</p>
          <p className="muted"><strong>Domain Logic Engine:</strong> Pure C++17 OOP Executable</p>
          <p className="muted"><strong>Database:</strong> Firebase Cloud Firestore</p>
          <p className="muted"><strong>Authentication:</strong> Firebase ID Token Verification</p>
          <p className="muted"><strong>AI & NLP Service:</strong> Python 3.11+ FastAPI + RAG</p>
          <p className="muted"><strong>Telegram Integration:</strong> Telegram Bot API Adapter</p>
        </Card>
      </div>
    </>
  );
}
