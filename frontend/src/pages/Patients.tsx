import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Badge, Button, Modal, StatCard } from '../components/Ui';
import { Icon } from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import { downloadFile, get, post } from '../services/api';
import type { Patient, Priority, QueueToken, Appointment, AvailableSlotResponse } from '../types';

type DoctorItem = {
  id: string;
  uid?: string;
  name: string;
  specialization?: string;
  room?: string;
  fee?: string | number;
  onDuty?: boolean;
};

const emptyForm = {
  name: '',
  phone: '',
  email: '',
  telegramContact: '',
  age: '',
  gender: 'Female',
  notes: '',
};

export default function Patients() {
  const { profile } = useAuth();
  const canRegister = profile?.role === 'ADMIN' || profile?.role === 'RECEPTIONIST';

  // Core Data
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Doctor & Specialization Options
  const [doctors, setDoctors] = useState<DoctorItem[]>([]);
  const [specializations, setSpecializations] = useState<string[]>([]);

  // New Patient Registration Form State
  const [form, setForm] = useState(emptyForm);
  const [visitType, setVisitType] = useState<'WALK_IN' | 'APPOINTMENT' | 'NONE'>('WALK_IN');
  const [selectedSpecialization, setSelectedSpecialization] = useState('ALL');
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [appointmentDate, setAppointmentDate] = useState(new Date().toISOString().split('T')[0]);
  const [appointmentSlot, setAppointmentSlot] = useState('');
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotCapacity, setSlotCapacity] = useState<{ totalSlots: number; remaining: number; booked: number; reason?: string } | null>(null);

  // Returning Patient New Visit State
  const [returningVisitType, setReturningVisitType] = useState<'WALK_IN' | 'APPOINTMENT'>('WALK_IN');
  const [returningSpecialization, setReturningSpecialization] = useState('ALL');
  const [returningDoctorId, setReturningDoctorId] = useState('');
  const [returningPriority, setReturningPriority] = useState<Priority>('NORMAL');
  const [returningDate, setReturningDate] = useState(new Date().toISOString().split('T')[0]);
  const [returningSlot, setReturningSlot] = useState('');
  const [returningSlots, setReturningSlots] = useState<string[]>([]);
  const [returningLoadingSlots, setReturningLoadingSlots] = useState(false);
  const [returningSlotCapacity, setReturningSlotCapacity] = useState<{ totalSlots: number; remaining: number; booked: number; reason?: string } | null>(null);

  // Intake Result Feedback Modal
  const [intakeSuccess, setIntakeSuccess] = useState<{
    type: 'WALK_IN' | 'APPOINTMENT' | 'NONE';
    patientName: string;
    doctorName?: string;
    doctorSpecialization?: string;
    doctorRoom?: string;
    tokenNumber?: string;
    status?: string;
    priority?: string;
    position?: number;
    aheadCount?: number;
    estimatedWaitMinutes?: number;
    appointmentId?: string;
    date?: string;
    time?: string;
  } | null>(null);

  const patientRequest = useRef(0);
  const detailRequest = useRef(0);
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  // Load Active Doctors and Specializations
  useEffect(() => {
    get<DoctorItem[]>('/api/doctors')
      .then((data) => setDoctors(data || []))
      .catch((err) => console.error('Failed to load doctors:', err));

    get<string[]>('/api/specializations')
      .then((specs) => setSpecializations(specs || []))
      .catch(() => setSpecializations(["General Physician", "Cardiologist", "Pediatrician", "Dermatologist"]));
  }, []);

  // Filtered Doctors for New Registration
  const filteredDoctors = useMemo(() => {
    if (selectedSpecialization === 'ALL') return doctors;
    const specLower = selectedSpecialization.toLowerCase();
    return doctors.filter((d) => (d.specialization || '').toLowerCase() === specLower);
  }, [doctors, selectedSpecialization]);

  // Filtered Doctors for Returning Patient
  const returningFilteredDoctors = useMemo(() => {
    if (returningSpecialization === 'ALL') return doctors;
    const specLower = returningSpecialization.toLowerCase();
    return doctors.filter((d) => (d.specialization || '').toLowerCase() === specLower);
  }, [doctors, returningSpecialization]);

  // Handle Specialization change for New Registration
  const handleSpecializationChange = (spec: string) => {
    setSelectedSpecialization(spec);
    if (selectedDoctorId) {
      const currentDoc = doctors.find((d) => (d.uid || d.id) === selectedDoctorId);
      if (currentDoc && spec !== 'ALL' && (currentDoc.specialization || '').toLowerCase() !== spec.toLowerCase()) {
        setSelectedDoctorId('');
        setAppointmentSlot('');
      }
    }
  };

  // Handle Specialization change for Returning Patient
  const handleReturningSpecializationChange = (spec: string) => {
    setReturningSpecialization(spec);
    if (returningDoctorId) {
      const currentDoc = doctors.find((d) => (d.uid || d.id) === returningDoctorId);
      if (currentDoc && spec !== 'ALL' && (currentDoc.specialization || '').toLowerCase() !== spec.toLowerCase()) {
        setReturningDoctorId('');
        setReturningSlot('');
      }
    }
  };

  // Auto-switch to Senior priority if age >= 60 in registration form
  const handleAgeChange = (val: string) => {
    setForm({ ...form, age: val });
    const num = Number(val);
    if (!isNaN(num) && num >= 60 && priority !== 'EMERGENCY') {
      setPriority('SENIOR');
    }
  };

  // Fetch available slots for New Registration when Doctor or Date changes
  useEffect(() => {
    if (visitType === 'APPOINTMENT' && selectedDoctorId && appointmentDate) {
      setLoadingSlots(true);
      get<AvailableSlotResponse>(`/api/appointments/available-slots?doctorId=${selectedDoctorId}&date=${appointmentDate}`)
        .then((res) => {
          setAvailableSlots(res.slots || []);
          setSlotCapacity({
            totalSlots: res.totalSlots || 0,
            remaining: res.remaining || 0,
            booked: res.booked || 0,
            reason: res.reason,
          });
          if (!res.slots.includes(appointmentSlot)) {
            setAppointmentSlot('');
          }
        })
        .catch(() => {
          setAvailableSlots([]);
          setSlotCapacity(null);
        })
        .finally(() => setLoadingSlots(false));
    } else {
      setAvailableSlots([]);
      setSlotCapacity(null);
    }
  }, [visitType, selectedDoctorId, appointmentDate]);

  // Fetch available slots for Returning Patient when Doctor or Date changes
  useEffect(() => {
    if (returningVisitType === 'APPOINTMENT' && returningDoctorId && returningDate) {
      setReturningLoadingSlots(true);
      get<AvailableSlotResponse>(`/api/appointments/available-slots?doctorId=${returningDoctorId}&date=${returningDate}`)
        .then((res) => {
          setReturningSlots(res.slots || []);
          setReturningSlotCapacity({
            totalSlots: res.totalSlots || 0,
            remaining: res.remaining || 0,
            booked: res.booked || 0,
            reason: res.reason,
          });
          if (!res.slots.includes(returningSlot)) {
            setReturningSlot('');
          }
        })
        .catch(() => {
          setReturningSlots([]);
          setReturningSlotCapacity(null);
        })
        .finally(() => setReturningLoadingSlots(false));
    } else {
      setReturningSlots([]);
      setReturningSlotCapacity(null);
    }
  }, [returningVisitType, returningDoctorId, returningDate]);

  // Load Patients list with search debouncing
  const loadPatients = useCallback(async (term: string) => {
    const requestId = ++patientRequest.current;
    setLoading(true);
    setError('');
    try {
      const suffix = term.trim() ? `?search=${encodeURIComponent(term.trim())}` : '';
      const result = await get<Patient[]>(`/api/patients${suffix}`);
      if (requestId === patientRequest.current) setPatients(result);
    } catch (reason) {
      if (requestId === patientRequest.current) {
        setError(reason instanceof Error ? reason.message : 'Unable to load patients.');
      }
    } finally {
      if (requestId === patientRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadPatients(search), 250);
    return () => window.clearTimeout(timeout);
  }, [loadPatients, search]);

  // Open Patient Details
  async function openPatient(id: string) {
    const requestId = ++detailRequest.current;
    setError('');
    setSelected(null);
    setReturningDoctorId('');
    setReturningSlot('');
    try {
      const patient = await get<Patient>(`/api/patients/${encodeURIComponent(id)}`);
      if (requestId === detailRequest.current) {
        setSelected(patient);
        setReturningPriority(patient.age >= 60 ? 'SENIOR' : 'NORMAL');
      }
    } catch (reason) {
      if (requestId === detailRequest.current) {
        setError(reason instanceof Error ? reason.message : 'Unable to load patient.');
      }
    }
  }

  // Register New Patient Form Submit
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');

    // Doctor selection validation
    if (visitType === 'WALK_IN' || visitType === 'APPOINTMENT') {
      if (!selectedDoctorId) {
        setError('Please select a consulting doctor.');
        return;
      }
    }

    if (visitType === 'APPOINTMENT' && (!appointmentDate || !appointmentSlot)) {
      setError('Please select an appointment date and available time slot.');
      return;
    }

    setSaving(true);
    try {
      const res = await post<Patient & { walkInToken?: any; appointment?: any }>('/api/patients', {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        telegramPhone: (form.telegramContact || form.phone).trim(),
        telegramChatId: form.telegramContact?.trim() || undefined,
        age: Number(form.age),
        gender: form.gender,
        notes: form.notes.trim(),
        visitType,
        doctorId: selectedDoctorId || undefined,
        specialization: selectedSpecialization !== 'ALL' ? selectedSpecialization : undefined,
        priority,
        appointmentDate: visitType === 'APPOINTMENT' ? appointmentDate : undefined,
        appointmentTime: visitType === 'APPOINTMENT' ? appointmentSlot : undefined,
      });

      const selectedDoc = doctors.find((d) => (d.uid || d.id) === selectedDoctorId);

      if (res.walkInToken) {
        setIntakeSuccess({
          type: 'WALK_IN',
          patientName: res.name,
          doctorName: selectedDoc?.name || res.walkInToken.doctorName,
          doctorSpecialization: selectedDoc?.specialization || res.walkInToken.doctorSpecialization,
          doctorRoom: selectedDoc?.room || res.walkInToken.doctorRoom,
          tokenNumber: res.walkInToken.tokenNumber,
          status: res.walkInToken.status,
          priority: res.walkInToken.priority,
          position: res.walkInToken.position,
          aheadCount: res.walkInToken.aheadCount,
          estimatedWaitMinutes: res.walkInToken.estimatedWaitMinutes,
        });
        setNotice(`✅ Patient registered & Walk-in Token ${res.walkInToken.tokenNumber} assigned for Dr. ${selectedDoc?.name || 'Physician'}.`);
      } else if (res.appointment) {
        setIntakeSuccess({
          type: 'APPOINTMENT',
          patientName: res.name,
          doctorName: selectedDoc?.name || res.appointment.doctorName,
          doctorSpecialization: selectedDoc?.specialization || res.appointment.doctorSpecialization,
          doctorRoom: selectedDoc?.room || res.appointment.doctorRoom,
          appointmentId: res.appointment.id,
          date: res.appointment.date,
          time: res.appointment.startTime,
        });
        setNotice(`✅ Patient registered & Appointment confirmed for ${res.appointment.date} at ${res.appointment.startTime}.`);
      } else {
        setIntakeSuccess({
          type: 'NONE',
          patientName: res.name,
        });
        setNotice('✅ Patient profile created successfully.');
      }

      setForm(emptyForm);
      setSelectedDoctorId('');
      setAppointmentSlot('');
      await loadPatients(search);
      setSelected(res);
    } catch (reason: any) {
      setError(reason.message || 'Unable to register patient.');
    } finally {
      setSaving(false);
    }
  }

  // Returning Patient: Add to Walk-in Queue
  async function addReturningToQueue(patient: Patient) {
    if (!returningDoctorId) {
      setError('Please select a consulting doctor for the walk-in visit.');
      return;
    }
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const res = await post<QueueToken>('/api/queue', {
        patientId: patient.id,
        doctorId: returningDoctorId,
        priority: returningPriority,
      });

      const selectedDoc = doctors.find((d) => (d.uid || d.id) === returningDoctorId);
      setIntakeSuccess({
        type: 'WALK_IN',
        patientName: patient.name,
        doctorName: selectedDoc?.name || res.doctorName || 'Assigned Physician',
        doctorSpecialization: selectedDoc?.specialization || res.doctorSpecialization,
        doctorRoom: selectedDoc?.room || res.doctorRoom,
        tokenNumber: res.tokenNumber,
        status: res.status,
        priority: res.priority,
        position: res.position || 1,
        aheadCount: res.aheadCount || 0,
        estimatedWaitMinutes: res.estimatedWaitMinutes || 15,
      });
      setNotice(`✅ Walk-in ticket issued: Token ${res.tokenNumber} for Dr. ${selectedDoc?.name || 'Physician'}.`);
    } catch (reason: any) {
      setError(reason.message || 'Unable to add patient to queue.');
    } finally {
      setSaving(false);
    }
  }

  // Returning Patient: Book Scheduled Appointment
  async function bookReturningAppointment(patient: Patient) {
    if (!returningDoctorId || !returningDate || !returningSlot) {
      setError('Please select consulting doctor, appointment date, and available time slot.');
      return;
    }
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const res = await post<Appointment>('/api/appointments', {
        patientId: patient.id,
        doctorId: returningDoctorId,
        date: returningDate,
        startTime: returningSlot,
        priority: returningPriority,
        source: 'RECEPTION_BOOKING',
      });

      const selectedDoc = doctors.find((d) => (d.uid || d.id) === returningDoctorId);
      setIntakeSuccess({
        type: 'APPOINTMENT',
        patientName: patient.name,
        doctorName: selectedDoc?.name || res.doctorName || 'Assigned Physician',
        doctorSpecialization: selectedDoc?.specialization || res.doctorSpecialization,
        doctorRoom: selectedDoc?.room || res.doctorRoom,
        appointmentId: res.id,
        date: res.date,
        time: res.startTime,
      });
      setNotice(`✅ Appointment confirmed: ${res.date} at ${res.startTime} with Dr. ${selectedDoc?.name || 'Physician'}.`);
    } catch (reason: any) {
      setError(reason.message || 'Unable to book appointment.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="content">
      {/* Header */}
      <div className="pagehead">
        <div>
          <div className="eyebrow">PATIENT INTAKE & REGISTRY</div>
          <h1>Patient Register</h1>
          <p>Register new patients with doctor assignment, intake walk-ins to live queue, or schedule visits.</p>
        </div>
        {canRegister && (
          <Button
            variant="primary"
            onClick={() => {
              document.getElementById('new-patient')?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <Icon name="plus" size={16} />
            <span>New Patient Intake</span>
          </Button>
        )}
      </div>

      {/* Alerts */}
      {error && (
        <div className="error page-error" role="alert" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="alert" size={18} />
            <span>{error}</span>
          </div>
          <button className="btn-icon" onClick={() => setError('')} style={{ height: 28, width: 28, border: 0 }}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {notice && (
        <div className="success page-error" role="status" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="check" size={18} />
            <span>{notice}</span>
          </div>
          <button className="btn-icon" onClick={() => setNotice('')} style={{ height: 28, width: 28, border: 0 }}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {/* INTAKE RESULT MODAL */}
      <Modal
        isOpen={!!intakeSuccess}
        onClose={() => setIntakeSuccess(null)}
        maxWidth="540px"
        title={
          intakeSuccess?.type === 'WALK_IN'
            ? '🎫 Walk-in Queue Ticket Issued'
            : intakeSuccess?.type === 'APPOINTMENT'
            ? '📅 Appointment Booking Confirmed'
            : '👤 Patient Profile Registered'
        }
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
            <Button variant="primary" onClick={() => setIntakeSuccess(null)}>
              Done / Continue
            </Button>
          </div>
        }
      >
        {intakeSuccess && (
          <div style={{ display: 'grid', gap: 14 }}>
            {intakeSuccess.type === 'WALK_IN' && (
              <div
                style={{
                  background: '#f0fdfa',
                  border: '1px solid #99f6e4',
                  borderRadius: 12,
                  padding: '20px',
                  textAlign: 'center',
                }}
              >
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#0f766e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Live Queue Token
                </span>
                <div style={{ fontSize: '38px', fontWeight: 800, color: '#0f766e', margin: '4px 0' }}>
                  {intakeSuccess.tokenNumber}
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 8 }}>
                  <Badge tone={intakeSuccess.priority === 'EMERGENCY' ? 'emergency' : intakeSuccess.priority === 'SENIOR' ? 'senior' : 'normal'}>
                    {intakeSuccess.priority || 'NORMAL'} Priority
                  </Badge>
                  <Badge tone="teal">
                    Position #{intakeSuccess.position || 1} ({intakeSuccess.aheadCount || 0} ahead)
                  </Badge>
                </div>
                <p style={{ margin: '12px 0 0', fontSize: '12.5px', color: '#134e4a' }}>
                  Estimated waiting time: ~{intakeSuccess.estimatedWaitMinutes || 15} mins
                </p>
              </div>
            )}

            {intakeSuccess.type === 'APPOINTMENT' && (
              <div
                style={{
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: 12,
                  padding: '18px 20px',
                }}
              >
                <div style={{ fontSize: '12px', color: '#1d4ed8', fontWeight: 700, textTransform: 'uppercase' }}>
                  Reserved Consultation Window
                </div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#1e40af', margin: '4px 0' }}>
                  {intakeSuccess.date} at {intakeSuccess.time}
                </div>
                <small style={{ color: '#3b82f6', fontFamily: 'monospace' }}>
                  Appointment ID: {intakeSuccess.appointmentId}
                </small>
              </div>
            )}

            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                padding: '14px 18px',
                display: 'grid',
                gap: 8,
                fontSize: '13px',
              }}
            >
              <div>👤 <b>Patient Name:</b> {intakeSuccess.patientName}</div>
              {intakeSuccess.doctorName && (
                <div>🩺 <b>Consulting Doctor:</b> Dr. {intakeSuccess.doctorName} ({intakeSuccess.doctorSpecialization || 'General'})</div>
              )}
              {intakeSuccess.doctorRoom && (
                <div>📍 <b>Consultation Room:</b> {intakeSuccess.doctorRoom}</div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <div className="grid2">
        {/* LEFT COLUMN: PATIENT SEARCH & RETURNING PATIENT INTAKE */}
        <div className="patient-column">
          <Card title="Patient Registry & Search">
            <div className="search">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="Search patients"
                placeholder="Search patient name or phone…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            {loading ? (
              <div className="empty">Loading patient records…</div>
            ) : error && patients.length === 0 ? (
              <div className="empty">Patient register unavailable. Retry the request.</div>
            ) : patients.length === 0 ? (
              <div className="empty">
                {search ? 'No patients match this search.' : 'No patients registered yet.'}
              </div>
            ) : (
              <div className="table" style={{ maxHeight: '340px', overflowY: 'auto' }}>
                {patients.map((patient) => (
                  <button
                    className={`tr patient-row${selected?.id === patient.id ? ' selected' : ''}`}
                    key={patient.id}
                    onClick={() => void openPatient(patient.id)}
                  >
                    <div>
                      <b>{patient.name}</b>
                      <small>{patient.phone}{patient.email ? ` · ${patient.email}` : ''} · {patient.age} yrs · ID: {patient.id.slice(0, 8)}</small>
                    </div>
                    <Badge tone="neutral">{patient.gender}</Badge>
                  </button>
                ))}
              </div>
            )}
          </Card>

          {/* SELECTED / RETURNING PATIENT DETAILS & NEW VISIT INTAKE */}
          {selected && (
            <Card
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span>Patient Profile</span>
                  <Badge tone="teal">#{selected.id.slice(0, 8).toUpperCase()}</Badge>
                </div>
              }
            >
              <div className="patient-detail">
                <div className="detail-head">
                  <div>
                    <b style={{ fontSize: '15px' }}>{selected.name}</b>
                    <small>{selected.phone}{selected.email ? ` · ✉️ ${selected.email}` : ' · ⚠️ No email'} · {selected.age} years · {selected.gender}</small>
                  </div>
                </div>

                {selected.notes && (
                  <p style={{ margin: '4px 0', fontSize: '12.5px', color: '#475569', background: '#f8fafc', padding: '8px 12px', borderRadius: 6 }}>
                    Notes: {selected.notes}
                  </p>
                )}

                {/* RETURNING PATIENT: DOCTOR-WISE VISIT INTAKE SECTION */}
                {canRegister && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: '16px',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 10,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <b style={{ fontSize: '13.5px', color: '#0f172a' }}>Intake Returning Patient</b>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className={`btn btn-sm ${returningVisitType === 'WALK_IN' ? 'primary' : 'secondary'}`}
                          onClick={() => setReturningVisitType('WALK_IN')}
                        >
                          Walk-In
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm ${returningVisitType === 'APPOINTMENT' ? 'primary' : 'secondary'}`}
                          onClick={() => setReturningVisitType('APPOINTMENT')}
                        >
                          Appointment
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: 10 }}>
                      {/* Specialization Filter */}
                      <label style={{ display: 'grid', gap: 4, fontSize: '12px', fontWeight: 600 }}>
                        Department / Specialization
                        <select
                          value={returningSpecialization}
                          onChange={(e) => handleReturningSpecializationChange(e.target.value)}
                          style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }}
                        >
                          <option value="ALL">All Medical Specialties</option>
                          {specializations.map((spec) => (
                            <option key={spec} value={spec}>{spec}</option>
                          ))}
                        </select>
                      </label>

                      {/* Consulting Doctor Dropdown */}
                      <label style={{ display: 'grid', gap: 4, fontSize: '12px', fontWeight: 600 }}>
                        Consulting Doctor *
                        <select
                          value={returningDoctorId}
                          onChange={(e) => setReturningDoctorId(e.target.value)}
                          style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }}
                        >
                          <option value="">Select Consulting Doctor…</option>
                          {returningFilteredDoctors.map((d) => (
                            <option key={d.uid || d.id} value={d.uid || d.id}>
                              Dr. {d.name} ({d.specialization || 'General'}) {d.room ? `· ${d.room}` : ''}
                            </option>
                          ))}
                        </select>
                      </label>

                      {returningFilteredDoctors.length === 0 && (
                        <div style={{ fontSize: '11.5px', color: '#b91c1c', background: '#fef2f2', padding: '6px 10px', borderRadius: 6 }}>
                          ⚠️ No eligible doctors available for {returningSpecialization}.
                        </div>
                      )}

                      {/* Walk-in Priority */}
                      {returningVisitType === 'WALK_IN' && (
                        <label style={{ display: 'grid', gap: 4, fontSize: '12px', fontWeight: 600 }}>
                          Queue Priority Level
                          <select
                            value={returningPriority}
                            onChange={(e) => setReturningPriority(e.target.value as Priority)}
                            style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }}
                          >
                            <option value="NORMAL">NORMAL (Standard FIFO)</option>
                            <option value="SENIOR">SENIOR (Senior Citizen 60+)</option>
                            <option value="EMERGENCY">EMERGENCY (Immediate Top Priority)</option>
                          </select>
                        </label>
                      )}

                      {/* Appointment Date & Slot */}
                      {returningVisitType === 'APPOINTMENT' && (
                        <>
                          <label style={{ display: 'grid', gap: 4, fontSize: '12px', fontWeight: 600 }}>
                            Appointment Date
                            <input
                              type="date"
                              min={todayStr}
                              value={returningDate}
                              onChange={(e) => setReturningDate(e.target.value)}
                              style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }}
                            />
                          </label>

                          <div>
                            <span style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                              Available Time Slot *
                            </span>
                            {returningLoadingSlots ? (
                              <p className="muted" style={{ margin: 0 }}>Checking physician schedule…</p>
                            ) : !returningDoctorId ? (
                              <p className="muted" style={{ margin: 0 }}>Select a consulting doctor to view slots.</p>
                            ) : returningSlotCapacity?.reason ? (
                              <p style={{ margin: 0, fontSize: '12px', color: '#b91c1c' }}>
                                Unavailable: {returningSlotCapacity.reason}
                              </p>
                            ) : returningSlots.length === 0 ? (
                              <p className="muted" style={{ margin: 0 }}>No slots remaining for this date.</p>
                            ) : (
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {returningSlots.map((slot) => (
                                  <button
                                    key={slot}
                                    type="button"
                                    className={`slot-pill-btn ${returningSlot === slot ? 'selected' : ''}`}
                                    style={{ padding: '6px 10px', fontSize: '12px' }}
                                    onClick={() => setReturningSlot(slot)}
                                  >
                                    {slot}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </>
                      )}

                      <div style={{ marginTop: 8 }}>
                        {returningVisitType === 'WALK_IN' ? (
                          <Button
                            variant="primary"
                            disabled={saving || !returningDoctorId}
                            onClick={() => void addReturningToQueue(selected)}
                          >
                            <Icon name="queue" size={15} />
                            <span>{saving ? 'Issuing Ticket…' : 'Issue Walk-in Ticket'}</span>
                          </Button>
                        ) : (
                          <Button
                            variant="primary"
                            disabled={saving || !returningDoctorId || !returningDate || !returningSlot}
                            onClick={() => void bookReturningAppointment(selected)}
                          >
                            <Icon name="calendar" size={15} />
                            <span>{saving ? 'Booking…' : 'Confirm Appointment'}</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Consultation History */}
                <h4 style={{ margin: '16px 0 8px' }}>Consultation History</h4>
                {selected.consultations?.length ? (
                  <div className="visit-list" style={{ maxHeight: 200, overflowY: 'auto' }}>
                    {selected.consultations.map((visit) => (
                      <div className="visit" key={visit.id}>
                        <b>{visit.diagnosis}</b>
                        <small>
                          {new Date(visit.createdAt).toLocaleString()} · Dr. {visit.doctorName} ({visit.doctorSpecialization || 'General'})
                        </small>
                        {visit.notes && <p>{visit.notes}</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty compact">No prior consultation history.</div>
                )}

                {/* Prescriptions */}
                {selected.prescriptions?.length ? (
                  <div className="prescription-list" style={{ marginTop: 14 }}>
                    <h4 style={{ margin: '0 0 8px' }}>Prescriptions</h4>
                    {selected.prescriptions.map((record) => (
                      <div className="visit" key={record.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <b>{record.diagnosis || 'Prescription PDF'}</b>
                          <small>{new Date(record.createdAt).toLocaleDateString()} · {record.fileName}</small>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            void downloadFile(record.downloadUrl, `prescription-${record.id}.pdf`).catch((reason: unknown) =>
                              setError(reason instanceof Error ? reason.message : 'Unable to download prescription.')
                            )
                          }
                        >
                          <Icon name="printer" size={14} />
                          <span>PDF</span>
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </Card>
          )}
        </div>

        {/* RIGHT COLUMN: RECEPTIONIST ADD PATIENT FORM WITH CONSULTING DOCTOR SELECTION */}
        {canRegister && (
          <Card title="Add Patient & Intake">
            <form id="new-patient" className="form-grid" onSubmit={submit}>
              {/* Visit Type Selector */}
              <div className="full" style={{ marginBottom: 6 }}>
                <span className="stat-label" style={{ display: 'block', marginBottom: 6 }}>
                  Intake Type
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  <button
                    type="button"
                    className={`btn ${visitType === 'WALK_IN' ? 'primary' : 'secondary'}`}
                    onClick={() => setVisitType('WALK_IN')}
                  >
                    <Icon name="queue" size={15} />
                    <span>Walk-In Queue</span>
                  </button>

                  <button
                    type="button"
                    className={`btn ${visitType === 'APPOINTMENT' ? 'primary' : 'secondary'}`}
                    onClick={() => setVisitType('APPOINTMENT')}
                  >
                    <Icon name="calendar" size={15} />
                    <span>Appointment</span>
                  </button>

                  <button
                    type="button"
                    className={`btn ${visitType === 'NONE' ? 'primary' : 'secondary'}`}
                    onClick={() => setVisitType('NONE')}
                  >
                    <Icon name="user" size={15} />
                    <span>Profile Only</span>
                  </button>
                </div>
              </div>

              {/* Patient Basic Information */}
              <label className="full">
                Full Name *
                <input
                  placeholder="e.g. John Doe"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  minLength={2}
                  maxLength={120}
                  required
                />
              </label>

              <label>
                Phone Number *
                <input
                  placeholder="+919876543210"
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                  type="tel"
                  minLength={7}
                  maxLength={20}
                  required
                />
              </label>

              <label>
                Email Address (For Prescription Delivery)
                <input
                  type="email"
                  placeholder="e.g. patient@example.com"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  title="Official prescription PDF will be emailed directly to this address"
                />
              </label>

              <label>
                Telegram Phone / Chat ID (Optional)
                <input
                  placeholder="e.g. +919359731276 or Chat ID"
                  value={form.telegramContact}
                  onChange={(event) => setForm({ ...form, telegramContact: event.target.value })}
                  title="Enter Telegram mobile number or Chat ID for instant digital prescription delivery"
                />
              </label>

              <label>
                Age (Years) *
                <input
                  type="number"
                  placeholder="35"
                  value={form.age}
                  onChange={(event) => handleAgeChange(event.target.value)}
                  min={0}
                  max={130}
                  step={1}
                  required
                />
              </label>

              <label>
                Gender *
                <select
                  value={form.gender}
                  onChange={(event) => setForm({ ...form, gender: event.target.value })}
                >
                  <option>Female</option>
                  <option>Male</option>
                  <option>Other</option>
                </select>
              </label>

              {/* CONSULTING DOCTOR & SPECIALIZATION FIELDS */}
              {visitType !== 'NONE' && (
                <>
                  <label>
                    Specialization
                    <select
                      value={selectedSpecialization}
                      onChange={(e) => handleSpecializationChange(e.target.value)}
                    >
                      <option value="ALL">All Medical Specialties</option>
                      {specializations.map((spec) => (
                        <option key={spec} value={spec}>{spec}</option>
                      ))}
                    </select>
                  </label>

                  <label className="full">
                    Consulting Doctor *
                    <select
                      value={selectedDoctorId}
                      onChange={(e) => setSelectedDoctorId(e.target.value)}
                      required
                    >
                      <option value="">Select Consulting Doctor…</option>
                      {filteredDoctors.map((d) => (
                        <option key={d.uid || d.id} value={d.uid || d.id}>
                          Dr. {d.name} ({d.specialization || 'General'}) {d.room ? `· ${d.room}` : ''} {d.onDuty !== false ? '· On Duty' : ''}
                        </option>
                      ))}
                    </select>
                  </label>

                  {filteredDoctors.length === 0 && (
                    <div className="full" style={{ fontSize: '12px', color: '#b91c1c', background: '#fef2f2', padding: '8px 12px', borderRadius: 8 }}>
                      ⚠️ No eligible doctors found for department "{selectedSpecialization}". Please select another specialization.
                    </div>
                  )}

                  {/* WALK-IN PRIORITY */}
                  {visitType === 'WALK_IN' && (
                    <label className="full">
                      Queue Priority
                      <select
                        value={priority}
                        onChange={(e) => setPriority(e.target.value as Priority)}
                      >
                        <option value="NORMAL">NORMAL (Standard FIFO Queue)</option>
                        <option value="SENIOR">SENIOR (Senior Citizen Priority)</option>
                        <option value="EMERGENCY">EMERGENCY (Immediate High Priority)</option>
                      </select>
                      {Number(form.age) >= 60 && (
                        <span style={{ fontSize: '11px', color: '#b45309', marginTop: 2 }}>
                          ★ Age 60+ detected: Senior priority automatically recommended.
                        </span>
                      )}
                    </label>
                  )}

                  {/* APPOINTMENT DATE & SLOTS */}
                  {visitType === 'APPOINTMENT' && (
                    <>
                      <label className="full">
                        Appointment Date *
                        <input
                          type="date"
                          min={todayStr}
                          value={appointmentDate}
                          onChange={(e) => setAppointmentDate(e.target.value)}
                          required
                        />
                      </label>

                      <div className="full">
                        <span style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                          Available Time Slots *
                        </span>
                        {loadingSlots ? (
                          <p className="muted">Loading slots from scheduling engine…</p>
                        ) : !selectedDoctorId ? (
                          <p className="muted">Please select a consulting doctor above to view available consultation slots.</p>
                        ) : slotCapacity?.reason ? (
                          <div style={{ color: '#b91c1c', background: '#fef2f2', padding: '8px 12px', borderRadius: 8, fontSize: '12px' }}>
                            Unavailable: {slotCapacity.reason}
                          </div>
                        ) : availableSlots.length === 0 ? (
                          <div style={{ color: '#b45309', background: '#fffbeb', padding: '8px 12px', borderRadius: 8, fontSize: '12px' }}>
                            All slots are fully booked for this date.
                          </div>
                        ) : (
                          <div className="slots-grid">
                            {availableSlots.map((slot) => (
                              <button
                                key={slot}
                                type="button"
                                className={`slot-pill-btn ${appointmentSlot === slot ? 'selected' : ''}`}
                                onClick={() => setAppointmentSlot(slot)}
                              >
                                {slot}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}

              {/* Patient Notes */}
              <label className="full">
                Patient Intake Notes (optional)
                <textarea
                  placeholder="Primary complaints, medical history, or intake notes…"
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  maxLength={2000}
                />
              </label>

              {/* Submit Button */}
              <div className="full" style={{ marginTop: 8 }}>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={saving || (visitType !== 'NONE' && !selectedDoctorId) || (visitType === 'APPOINTMENT' && !appointmentSlot)}
                >
                  <Icon name="check" size={16} />
                  <span>
                    {saving
                      ? 'Processing…'
                      : visitType === 'WALK_IN'
                      ? 'Register & Issue Walk-in Ticket'
                      : visitType === 'APPOINTMENT'
                      ? 'Register & Book Appointment'
                      : 'Create Patient Profile'}
                  </span>
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
