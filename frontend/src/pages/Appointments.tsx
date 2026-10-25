import { useEffect, useState, useCallback, useMemo } from 'react';
import { Card, Button, Badge, Modal, Drawer, StatCard, EmptyState, SkeletonRow } from '../components/Ui';
import { Icon } from '../components/Icon';
import { get, post, patch } from '../services/api';
import { Appointment, AvailableSlotResponse, FamilyMember, Patient, Priority } from '../types';
import { useAuth } from '../context/AuthContext';

type DoctorItem = {
  id: string;
  uid?: string;
  name: string;
  specialization?: string;
  room?: string;
  fee?: string | number;
  onDuty?: boolean;
};

export default function Appointments() {
  const { profile } = useAuth();

  // Core Data
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<DoctorItem[]>([]);
  const [specializations, setSpecializations] = useState<string[]>([]);
  const [loadingApts, setLoadingApts] = useState(true);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  // Filters
  const [filterDoctor, setFilterDoctor] = useState(profile?.role === 'DOCTOR' ? profile.uid : '');
  const [filterDate, setFilterDate] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterCheckIn, setFilterCheckIn] = useState('ALL');
  const [filterSpecialization, setFilterSpecialization] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Active Date Shortcut
  const [dateShortcut, setDateShortcut] = useState<'all' | 'today' | 'tomorrow' | 'week'>('all');

  // Details Drawer
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Actions in progress
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [checkinModalAppointment, setCheckinModalAppointment] = useState<Appointment | null>(null);
  const [checkinPriority, setCheckinPriority] = useState<Priority>('NORMAL');
  const [cancelModalAppointment, setCancelModalAppointment] = useState<Appointment | null>(null);

  // Booking Wizard State
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardPatient, setWizardPatient] = useState<{ id: string; name: string; phone?: string; age?: number; gender?: string } | null>(null);
  const [wizardSpecialization, setWizardSpecialization] = useState('ALL');
  const [wizardDoctor, setWizardDoctor] = useState<DoctorItem | null>(null);
  const [wizardDate, setWizardDate] = useState(new Date().toISOString().split('T')[0]);
  const [wizardSlot, setWizardSlot] = useState('');
  const [wizardNotes, setWizardNotes] = useState('');
  const [wizardPriority, setWizardPriority] = useState<Priority>('NORMAL');
  const [availability, setAvailability] = useState<AvailableSlotResponse | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingCompletedApt, setBookingCompletedApt] = useState<Appointment | null>(null);

  // Family Members & Patient Search for Wizard
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [patientSearchTerm, setPatientSearchTerm] = useState('');
  const [patientSearchResults, setPatientSearchResults] = useState<Patient[]>([]);
  const [searchingPatients, setSearchingPatients] = useState(false);

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const tomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }, []);

  // Next 7 days for quick date pills in booking wizard
  const next7Days = useMemo(() => {
    const list: { dateStr: string; label: string; weekday: string } = [] as any;
    const daysArr = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
      const label = i === 0 ? 'Today' : i === 1 ? 'Tmrw' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      daysArr.push({ dateStr, label, weekday });
    }
    return daysArr;
  }, []);

  // Load Doctors and Specializations
  useEffect(() => {
    get<DoctorItem[]>('/api/doctors')
      .then((data) => {
        setDoctors(data);
        if (profile?.role === 'DOCTOR') {
          setFilterDoctor(profile.uid);
        }
      })
      .catch((err) => console.error('Failed to load doctors:', err));

    get<string[]>('/api/specializations')
      .then(setSpecializations)
      .catch(() => setSpecializations(["General Physician", "Cardiologist", "Pediatrician", "Dermatologist"]));
  }, [profile?.role, profile?.uid]);

  // Load Family Members if PATIENT
  useEffect(() => {
    if (profile?.role === 'PATIENT') {
      get<{ members: FamilyMember[] }>('/api/patient-portal/family')
        .then((res) => {
          if (res?.members) {
            setFamilyMembers(res.members);
            const self = res.members.find(m => m.relationship === 'Self') || res.members[0];
            if (self) {
              setWizardPatient({
                id: self.patientId,
                name: self.name,
                phone: self.phone,
                age: self.age,
                gender: self.gender
              });
            }
          }
        })
        .catch((err) => console.error('Failed to load family members:', err));
    }
  }, [profile?.role]);

  // Load Appointments
  const loadAppointments = useCallback(async () => {
    setLoadingApts(true);
    setActionError('');
    try {
      const params = new URLSearchParams();

      if (profile?.role === 'DOCTOR') {
        params.set('doctorId', profile.uid);
      } else if (filterDoctor) {
        params.set('doctorId', filterDoctor);
      }

      if (filterDate) {
        params.set('date', filterDate);
      }

      if (filterStatus && filterStatus !== 'ALL') {
        params.set('status', filterStatus);
      }

      if (filterCheckIn && filterCheckIn !== 'ALL') {
        params.set('checkInStatus', filterCheckIn);
      }

      if (filterSpecialization && filterSpecialization !== 'ALL') {
        params.set('specialization', filterSpecialization);
      }

      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }

      const queryStr = params.toString() ? `?${params.toString()}` : '';
      const data = await get<Appointment[]>(`/api/appointments${queryStr}`);
      setAppointments(data);

      // If drawer is open, keep selected appointment updated
      if (selectedAppointment) {
        const updated = data.find(a => a.id === selectedAppointment.id);
        if (updated) setSelectedAppointment(updated);
      }
    } catch (err: any) {
      setActionError(err.message || 'Failed to load appointments.');
    } finally {
      setLoadingApts(false);
    }
  }, [profile?.role, profile?.uid, filterDoctor, filterDate, filterStatus, filterCheckIn, filterSpecialization, searchQuery, selectedAppointment]);

  useEffect(() => {
    void loadAppointments();
  }, [filterDoctor, filterDate, filterStatus, filterCheckIn, filterSpecialization, searchQuery]);

  // Date shortcut switcher
  const handleDateShortcut = (type: 'all' | 'today' | 'tomorrow' | 'week') => {
    setDateShortcut(type);
    if (type === 'all') {
      setFilterDate('');
    } else if (type === 'today') {
      setFilterDate(todayStr);
    } else if (type === 'tomorrow') {
      setFilterDate(tomorrowStr);
    } else if (type === 'week') {
      // In appointments query, filtering by today onwards
      setFilterDate(todayStr);
    }
  };

  // Reset all filters
  const handleResetFilters = () => {
    setFilterDate('');
    setFilterStatus('ALL');
    setFilterCheckIn('ALL');
    setFilterSpecialization('ALL');
    setSearchQuery('');
    setDateShortcut('all');
    if (profile?.role !== 'DOCTOR') setFilterDoctor('');
  };

  // KPI Statistics
  const stats = useMemo(() => {
    const total = appointments.length;
    const todayApts = appointments.filter(a => a.date === todayStr);
    const checkedIn = appointments.filter(a => a.status === 'CHECKED_IN' || a.checkInStatus === 'CHECKED_IN');
    const booked = appointments.filter(a => a.status === 'BOOKED' || a.status === 'CONFIRMED');
    const completed = appointments.filter(a => a.status === 'COMPLETED');
    const cancelled = appointments.filter(a => a.status === 'CANCELLED');
    return { total, todayCount: todayApts.length, checkedIn: checkedIn.length, booked: booked.length, completed: completed.length, cancelled: cancelled.length };
  }, [appointments, todayStr]);

  // Load available slots in Wizard
  useEffect(() => {
    const docId = wizardDoctor?.id || wizardDoctor?.uid;
    if (isBookingModalOpen && docId && wizardDate) {
      setLoadingSlots(true);
      get<AvailableSlotResponse>(`/api/appointments/available-slots?doctorId=${docId}&date=${wizardDate}`)
        .then((res) => {
          setAvailability(res);
          if (!res.slots.includes(wizardSlot)) {
            setWizardSlot('');
          }
        })
        .catch((err) => {
          console.error('Slot fetch error:', err);
          setAvailability(null);
        })
        .finally(() => setLoadingSlots(false));
    }
  }, [isBookingModalOpen, wizardDoctor, wizardDate]);

  // Search patients for Staff Booking
  const handleSearchPatients = async (term: string) => {
    setPatientSearchTerm(term);
    if (!term.trim()) {
      setPatientSearchResults([]);
      return;
    }
    setSearchingPatients(true);
    try {
      const res = await get<Patient[]>(`/api/patients?search=${encodeURIComponent(term.trim())}`);
      setPatientSearchResults(res || []);
    } catch {
      setPatientSearchResults([]);
    } finally {
      setSearchingPatients(false);
    }
  };

  // Open Details Drawer
  const handleOpenDetails = (apt: Appointment) => {
    setSelectedAppointment(apt);
    setIsDrawerOpen(true);
  };

  // Open Check-in Modal
  const handlePromptCheckin = (apt: Appointment, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const age = Number(apt.patientAge);
    setCheckinPriority(age >= 60 ? 'SENIOR' : 'NORMAL');
    setCheckinModalAppointment(apt);
  };

  // Confirm Check-In
  const handleConfirmCheckin = async () => {
    if (!checkinModalAppointment) return;
    const id = checkinModalAppointment.id;
    setProcessingId(id);
    setActionError('');
    setActionSuccess('');
    try {
      const res = await post<{
        queueToken: string;
        tokenNumber: string;
        priority: string;
      }>(`/api/appointments/${id}/checkin`, { priority: checkinPriority });

      const tokenDisplay = res.tokenNumber || res.queueToken || 'Assigned';
      setActionSuccess(`Check-in successful! Token: ${tokenDisplay} (${res.priority || checkinPriority} priority). Patient is now live in the queue.`);
      setCheckinModalAppointment(null);
      void loadAppointments();
      if (selectedAppointment?.id === id) {
        setIsDrawerOpen(false);
      }
    } catch (err: any) {
      setActionError(err.message || 'Check-in failed. Please try again.');
    } finally {
      setProcessingId(null);
    }
  };

  // Open Cancel Modal
  const handlePromptCancel = (apt: Appointment, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setCancelModalAppointment(apt);
  };

  // Confirm Cancel
  const handleConfirmCancel = async () => {
    if (!cancelModalAppointment) return;
    const id = cancelModalAppointment.id;
    setProcessingId(id);
    setActionError('');
    setActionSuccess('');
    try {
      await patch(`/api/appointments/${id}/cancel`);
      setActionSuccess('Appointment was cancelled successfully.');
      setCancelModalAppointment(null);
      void loadAppointments();
      if (selectedAppointment?.id === id) {
        setIsDrawerOpen(false);
      }
    } catch (err: any) {
      setActionError(err.message || 'Failed to cancel appointment.');
    } finally {
      setProcessingId(null);
    }
  };

  // Complete Appointment
  const handleComplete = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setProcessingId(id);
    setActionError('');
    setActionSuccess('');
    try {
      await patch(`/api/appointments/${id}/complete`);
      setActionSuccess('Appointment marked as COMPLETED.');
      void loadAppointments();
      if (selectedAppointment?.id === id) {
        setIsDrawerOpen(false);
      }
    } catch (err: any) {
      setActionError(err.message || 'Failed to complete appointment.');
    } finally {
      setProcessingId(null);
    }
  };

  // Open Booking Wizard
  const handleOpenBookingWizard = () => {
    setWizardStep(1);
    setWizardSlot('');
    setWizardNotes('');
    setWizardPriority('NORMAL');
    setBookingCompletedApt(null);
    setActionError('');
    setActionSuccess('');

    // Preselect doctor if user is DOCTOR
    if (profile?.role === 'DOCTOR') {
      const myDoc = doctors.find(d => (d.uid || d.id) === profile.uid);
      if (myDoc) {
        setWizardDoctor(myDoc);
        setWizardSpecialization(myDoc.specialization || 'ALL');
      }
    } else {
      setWizardDoctor(null);
      setWizardSpecialization('ALL');
    }

    // Preselect patient if PATIENT
    if (profile?.role === 'PATIENT' && familyMembers.length > 0) {
      const self = familyMembers.find(m => m.relationship === 'Self') || familyMembers[0];
      setWizardPatient({
        id: self.patientId,
        name: self.name,
        phone: self.phone,
        age: self.age,
        gender: self.gender
      });
    }

    setIsBookingModalOpen(true);
  };

  // Submit Booking Wizard
  const handleSubmitBooking = async () => {
    if (!wizardPatient || !wizardDoctor || !wizardDate || !wizardSlot) {
      setActionError('Please complete all booking steps.');
      return;
    }

    setBookingSubmitting(true);
    setActionError('');
    try {
      const docId = wizardDoctor.uid || wizardDoctor.id;
      const res = await post<Appointment>('/api/appointments', {
        doctorId: docId,
        patientId: wizardPatient.id,
        date: wizardDate,
        startTime: wizardSlot,
        notes: wizardNotes.trim(),
        priority: wizardPriority,
        specialization: wizardDoctor.specialization,
        source: 'WEB'
      });

      setBookingCompletedApt(res);
      setActionSuccess(`Appointment successfully booked for ${res.patientName} with Dr. ${res.doctorName} on ${res.date} at ${res.startTime}!`);
      void loadAppointments();
    } catch (err: any) {
      setActionError(err.message || 'Booking conflict or server error. Please choose another slot.');
    } finally {
      setBookingSubmitting(false);
    }
  };

  // Filtered Doctors for Wizard
  const wizardFilteredDoctors = useMemo(() => {
    if (wizardSpecialization === 'ALL') return doctors;
    return doctors.filter(d => (d.specialization || '').toLowerCase() === wizardSpecialization.toLowerCase());
  }, [doctors, wizardSpecialization]);

  return (
    <div className="content">
      {/* EXECUTIVE HEADER */}
      <div className="pagehead">
        <div>
          <div className="eyebrow">CLINIC CALENDAR & SCHEDULING</div>
          <h1>
            {profile?.role === 'DOCTOR'
              ? 'My Appointments'
              : profile?.role === 'PATIENT'
              ? 'My Healthcare Appointments'
              : 'Appointment Management'}
          </h1>
          <p>
            {profile?.role === 'DOCTOR'
              ? `Scheduled patient consultations and queue status for Dr. ${profile?.name || 'Physician'}`
              : profile?.role === 'PATIENT'
              ? 'View, book, and manage clinic appointments for yourself and family members'
              : 'Live schedule tracking, conflict-free booking, and instant patient check-in'}
          </p>
        </div>

        <div className="pagehead-actions">
          <Button
            variant="secondary"
            onClick={() => void loadAppointments()}
            title="Refresh appointments data"
          >
            <Icon name="refresh" size={16} />
            <span>Refresh</span>
          </Button>

          <Button
            variant="primary"
            onClick={handleOpenBookingWizard}
          >
            <Icon name="plus" size={16} />
            <span>Book Appointment</span>
          </Button>
        </div>
      </div>

      {/* FEEDBACK BANNERS */}
      {actionSuccess && (
        <div className="success" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon name="check" size={18} />
              <span>{actionSuccess}</span>
            </div>
            <button className="btn-icon" onClick={() => setActionSuccess('')} style={{ height: 28, width: 28, border: 0 }}>
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>
      )}

      {actionError && (
        <div className="error page-error" role="alert" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="alert" size={18} />
            <span>{actionError}</span>
          </div>
          <button className="btn-icon" onClick={() => setActionError('')} style={{ height: 28, width: 28, border: 0 }}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {/* KPI METRIC CARDS */}
      <div className="stats-grid">
        <StatCard
          label="Total Appointments"
          value={stats.total}
          icon="calendar"
          tone="primary"
          subvalue={filterDate ? `Filtered: ${filterDate}` : 'All active records'}
        />
        <StatCard
          label="Today's Appointments"
          value={stats.todayCount}
          icon="clock"
          tone="teal"
          subvalue="Scheduled for today"
          onClick={() => handleDateShortcut('today')}
        />
        <StatCard
          label="Checked-In (In Queue)"
          value={stats.checkedIn}
          icon="queue"
          tone="success"
          subvalue="Patients waiting or called"
        />
        <StatCard
          label="Booked (Upcoming)"
          value={stats.booked}
          icon="user"
          tone="warning"
          subvalue="Awaiting arrival"
        />
        <StatCard
          label="Completed"
          value={stats.completed}
          icon="check"
          tone="purple"
          subvalue="Consultations finished"
        />
      </div>

      {/* ADVANCED FILTER & SEARCH BAR */}
      <div className="filter-card">
        <div className="filter-grid">
          {/* Search Input */}
          <div className="filter-item">
            <span className="filter-label">Search</span>
            <div className="filter-input-wrap">
              <span className="search-icon-inside">
                <Icon name="search" size={16} />
              </span>
              <input
                type="text"
                placeholder="Search patient, doctor, token, ID…"
                className="search-input-with-icon"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Doctor Filter (Hidden or locked for DOCTOR role) */}
          {profile?.role !== 'DOCTOR' && (
            <div className="filter-item">
              <span className="filter-label">Doctor</span>
              <select
                value={filterDoctor}
                onChange={(e) => setFilterDoctor(e.target.value)}
              >
                <option value="">All Doctors (All Clinics)</option>
                {doctors.map((d) => (
                  <option key={d.uid || d.id} value={d.uid || d.id}>
                    Dr. {d.name} {d.specialization ? `(${d.specialization})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Specialization Filter */}
          <div className="filter-item">
            <span className="filter-label">Specialization</span>
            <select
              value={filterSpecialization}
              onChange={(e) => setFilterSpecialization(e.target.value)}
            >
              <option value="ALL">All Specializations</option>
              {specializations.map((spec) => (
                <option key={spec} value={spec}>{spec}</option>
              ))}
            </select>
          </div>

          {/* Date Picker */}
          <div className="filter-item">
            <span className="filter-label">Date</span>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => {
                setFilterDate(e.target.value);
                setDateShortcut('all');
              }}
            />
          </div>

          {/* Status Filter */}
          <div className="filter-item">
            <span className="filter-label">Status</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="BOOKED">Booked</option>
              <option value="CHECKED_IN">Checked In</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          {/* Reset Action */}
          <div className="filter-item" style={{ justifyContent: 'flex-end' }}>
            <Button
              variant="secondary"
              onClick={handleResetFilters}
              title="Reset all filters"
            >
              <Icon name="refresh" size={14} />
              <span>Reset</span>
            </Button>
          </div>
        </div>

        {/* Date Shortcut Pills */}
        <div className="date-shortcuts-bar">
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginRight: 4 }}>
            Quick Range:
          </span>
          <button
            className={`date-shortcut-btn ${dateShortcut === 'all' && !filterDate ? 'active' : ''}`}
            onClick={() => handleDateShortcut('all')}
          >
            All Dates
          </button>
          <button
            className={`date-shortcut-btn ${dateShortcut === 'today' || filterDate === todayStr ? 'active' : ''}`}
            onClick={() => handleDateShortcut('today')}
          >
            Today
          </button>
          <button
            className={`date-shortcut-btn ${dateShortcut === 'tomorrow' || filterDate === tomorrowStr ? 'active' : ''}`}
            onClick={() => handleDateShortcut('tomorrow')}
          >
            Tomorrow
          </button>
          <button
            className={`date-shortcut-btn ${dateShortcut === 'week' ? 'active' : ''}`}
            onClick={() => handleDateShortcut('week')}
          >
            This Week
          </button>
        </div>
      </div>

      {/* APPOINTMENTS DATA TABLE & MOBILE CARDS */}
      <div className="modern-table-container">
        <table className="modern-table">
          <thead>
            <tr>
              <th style={{ width: 120 }}>Token / Ref</th>
              <th>Patient</th>
              <th>Doctor</th>
              <th>Date & Schedule</th>
              <th>Priority</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loadingApts ? (
              <>
                <SkeletonRow cols={7} />
                <SkeletonRow cols={7} />
                <SkeletonRow cols={7} />
                <SkeletonRow cols={7} />
              </>
            ) : appointments.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    title="No appointments found"
                    description="No scheduled appointments match your selected filters. Adjust your criteria or book a new appointment."
                    action={
                      <Button variant="primary" onClick={handleOpenBookingWizard}>
                        <Icon name="plus" size={15} />
                        <span>Book an Appointment</span>
                      </Button>
                    }
                  />
                </td>
              </tr>
            ) : (
              appointments.map((apt) => {
                const isToday = apt.date === todayStr;
                const canCheckIn =
                  (apt.status === 'BOOKED' || apt.status === 'CONFIRMED');
                const canCancel =
                  apt.status !== 'CANCELLED' && apt.status !== 'COMPLETED' && apt.date >= todayStr;
                const canComplete =
                  (profile?.role === 'DOCTOR' || profile?.role === 'ADMIN' || profile?.role === 'RECEPTIONIST') &&
                  (apt.status === 'CHECKED_IN' || apt.status === 'BOOKED');

                return (
                  <tr
                    key={apt.id}
                    onClick={() => handleOpenDetails(apt)}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Token / Ref */}
                    <td>
                      {apt.queueToken ? (
                        <span className="table-token-pill">{apt.queueToken}</span>
                      ) : (
                        <span className="table-id-pill">#{apt.id.slice(-6).toUpperCase()}</span>
                      )}
                    </td>

                    {/* Patient */}
                    <td>
                      <div className="patient-cell">
                        <span className="patient-cell-name">{apt.patientName || 'Unknown Patient'}</span>
                        <div className="patient-cell-meta">
                          {apt.patientPhone && <span>📞 {apt.patientPhone}</span>}
                          {apt.patientAge && <span>· {apt.patientAge}y</span>}
                          {apt.patientGender && <span>· {apt.patientGender}</span>}
                        </div>
                      </div>
                    </td>

                    {/* Doctor */}
                    <td>
                      <div className="doctor-cell">
                        <span className="doctor-cell-name">Dr. {apt.doctorName}</span>
                        <span className="doctor-cell-spec">{apt.doctorSpecialization || 'General Practice'}</span>
                      </div>
                    </td>

                    {/* Schedule */}
                    <td>
                      <div className="schedule-cell">
                        <span className="schedule-date">{apt.date}</span>
                        <span className="schedule-time">
                          <Icon name="clock" size={12} />
                          {apt.startTime} {apt.endTime ? `– ${apt.endTime}` : ''}
                        </span>
                      </div>
                    </td>

                    {/* Priority */}
                    <td>
                      <Badge tone={apt.priority === 'EMERGENCY' ? 'emergency' : apt.priority === 'SENIOR' ? 'senior' : 'normal'}>
                        {apt.priority || 'NORMAL'}
                      </Badge>
                    </td>

                    {/* Status */}
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                        <Badge tone={apt.status}>
                          {apt.status === 'CHECKED_IN' && apt.queueToken
                            ? `In Queue (${apt.queueToken})`
                            : apt.status}
                        </Badge>
                        {apt.checkInStatus === 'NOT_ARRIVED' && apt.status === 'BOOKED' && (
                          <span style={{ fontSize: '11px', color: '#64748b' }}>Not Arrived</span>
                        )}
                      </div>
                    </td>

                    {/* Actions */}
                    <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                        {canCheckIn && (
                          <Button
                            variant="teal"
                            size="sm"
                            disabled={processingId === apt.id}
                            onClick={() => handlePromptCheckin(apt)}
                            title="Check-in patient to queue"
                          >
                            <Icon name="check" size={14} />
                            <span>Check-In</span>
                          </Button>
                        )}

                        {canComplete && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={processingId === apt.id}
                            onClick={() => void handleComplete(apt.id)}
                            title="Mark as completed"
                          >
                            <span>Complete</span>
                          </Button>
                        )}

                        {canCancel && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={processingId === apt.id}
                            onClick={() => handlePromptCancel(apt)}
                            title="Cancel appointment"
                          >
                            <span style={{ color: '#e11d48' }}>Cancel</span>
                          </Button>
                        )}

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenDetails(apt)}
                          title="View full appointment details"
                        >
                          <Icon name="chevron-right" size={16} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* MOBILE CARDS VIEW */}
      <div className="mobile-cards-grid">
        {loadingApts ? (
          <div className="loading-panel">Loading appointments…</div>
        ) : appointments.length === 0 ? (
          <EmptyState
            title="No appointments found"
            description="Adjust your filters or book a new appointment."
          />
        ) : (
          appointments.map((apt) => {
            const isToday = apt.date === todayStr;
            const canCheckIn =
              (apt.status === 'BOOKED' || apt.status === 'CONFIRMED');
            const canCancel =
              apt.status !== 'CANCELLED' && apt.status !== 'COMPLETED' && apt.date >= todayStr;

            return (
              <div
                key={apt.id}
                className="apt-mobile-card"
                onClick={() => handleOpenDetails(apt)}
              >
                <div className="apt-mobile-header">
                  <div>
                    <span style={{ fontWeight: 700, fontSize: '15px' }}>
                      📅 {apt.date} · ⏰ {apt.startTime}
                    </span>
                  </div>
                  <Badge tone={apt.status}>
                    {apt.status}
                  </Badge>
                </div>

                <div className="apt-mobile-body">
                  <div>👤 <b>Patient:</b> {apt.patientName}</div>
                  <div>🩺 <b>Doctor:</b> Dr. {apt.doctorName} ({apt.doctorSpecialization || 'General'})</div>
                  {apt.queueToken && (
                    <div>🎫 <b>Live Token:</b> <span className="table-token-pill">{apt.queueToken}</span></div>
                  )}
                </div>

                <div className="apt-mobile-actions" onClick={(e) => e.stopPropagation()}>
                  {canCheckIn && (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={processingId === apt.id}
                      onClick={() => handlePromptCheckin(apt)}
                    >
                      Check-In
                    </Button>
                  )}
                  {canCancel && (
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={processingId === apt.id}
                      onClick={() => handlePromptCancel(apt)}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleOpenDetails(apt)}
                    className="details-btn-right"
                  >
                    Details
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* APPOINTMENT DETAILS DRAWER */}
      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>Appointment Details</span>
            {selectedAppointment && (
              <Badge tone={selectedAppointment.status}>
                {selectedAppointment.status}
              </Badge>
            )}
          </div>
        }
        subtitle={selectedAppointment ? `Ref: #${selectedAppointment.id}` : ''}
        footer={
          selectedAppointment && (
            <div style={{ display: 'flex', gap: 10, width: '100%', justifyContent: 'space-between' }}>
              <div>
                {selectedAppointment.status !== 'CANCELLED' && selectedAppointment.status !== 'COMPLETED' && (
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={processingId === selectedAppointment.id}
                    onClick={() => handlePromptCancel(selectedAppointment)}
                  >
                    Cancel Appointment
                  </Button>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                {(selectedAppointment.status === 'BOOKED' || selectedAppointment.status === 'CONFIRMED') && (
                  <Button
                    variant="primary"
                    disabled={processingId === selectedAppointment.id}
                    onClick={() => handlePromptCheckin(selectedAppointment)}
                  >
                    <Icon name="check" size={15} />
                    <span>Check-In Patient</span>
                  </Button>
                )}

                {selectedAppointment.status === 'CHECKED_IN' && (
                  <Button
                    variant="secondary"
                    disabled={processingId === selectedAppointment.id}
                    onClick={() => handleComplete(selectedAppointment.id)}
                  >
                    <span>Mark Completed</span>
                  </Button>
                )}
              </div>
            </div>
          )
        }
      >
        {selectedAppointment && (
          <>
            {/* Live Queue Banner if checked in */}
            {selectedAppointment.queueToken && (
              <div style={{
                background: '#f0fdfa',
                border: '1px solid #99f6e4',
                borderRadius: 12,
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div>
                  <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#0f766e', fontWeight: 700 }}>
                    Live Queue Status
                  </span>
                  <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f766e' }}>
                    Token {selectedAppointment.queueToken}
                  </div>
                  <span style={{ fontSize: '12px', color: '#134e4a' }}>
                    Priority: {selectedAppointment.priority || 'NORMAL'}
                  </span>
                </div>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: '#ccfbf1',
                  color: '#0f766e',
                  display: 'grid',
                  placeItems: 'center'
                }}>
                  <Icon name="queue" size={24} />
                </div>
              </div>
            )}

            {/* Patient Info Card */}
            <Card title="Patient Profile">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: '13px' }}>
                <div>
                  <span className="stat-label">Full Name</span>
                  <p style={{ margin: '2px 0', fontWeight: 700 }}>{selectedAppointment.patientName}</p>
                </div>
                <div>
                  <span className="stat-label">Patient ID</span>
                  <p style={{ margin: '2px 0', fontFamily: 'monospace' }}>{selectedAppointment.patientId}</p>
                </div>
                <div>
                  <span className="stat-label">Phone</span>
                  <p style={{ margin: '2px 0' }}>{selectedAppointment.patientPhone || '—'}</p>
                </div>
                <div>
                  <span className="stat-label">Demographics</span>
                  <p style={{ margin: '2px 0' }}>
                    {selectedAppointment.patientAge ? `${selectedAppointment.patientAge} yrs` : '—'} · {selectedAppointment.patientGender || '—'}
                  </p>
                </div>
              </div>
            </Card>

            {/* Doctor Info Card */}
            <Card title="Doctor & Department">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: '13px' }}>
                <div>
                  <span className="stat-label">Attending Physician</span>
                  <p style={{ margin: '2px 0', fontWeight: 700 }}>Dr. {selectedAppointment.doctorName}</p>
                </div>
                <div>
                  <span className="stat-label">Specialization</span>
                  <p style={{ margin: '2px 0', color: '#0f766e', fontWeight: 600 }}>
                    {selectedAppointment.doctorSpecialization || 'General Practitioner'}
                  </p>
                </div>
                <div>
                  <span className="stat-label">Consultation Room</span>
                  <p style={{ margin: '2px 0' }}>{selectedAppointment.doctorRoom || 'Room 101'}</p>
                </div>
                <div>
                  <span className="stat-label">Appointment Source</span>
                  <p style={{ margin: '2px 0' }}>
                    <span className="badge neutral">{selectedAppointment.source || 'WEB'}</span>
                  </p>
                </div>
              </div>
            </Card>

            {/* Schedule Details Card */}
            <Card title="Schedule & Timing">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: '13px' }}>
                <div>
                  <span className="stat-label">Date</span>
                  <p style={{ margin: '2px 0', fontWeight: 700 }}>{selectedAppointment.date}</p>
                </div>
                <div>
                  <span className="stat-label">Reserved Window</span>
                  <p style={{ margin: '2px 0', fontWeight: 700, color: '#0f766e' }}>
                    {selectedAppointment.startTime} {selectedAppointment.endTime ? `– ${selectedAppointment.endTime}` : ''}
                  </p>
                </div>
                <div>
                  <span className="stat-label">Check-In Status</span>
                  <p style={{ margin: '2px 0' }}>
                    <Badge tone={selectedAppointment.checkInStatus === 'CHECKED_IN' ? 'teal' : 'neutral'}>
                      {selectedAppointment.checkInStatus || 'NOT_ARRIVED'}
                    </Badge>
                  </p>
                </div>
                <div>
                  <span className="stat-label">Booked At</span>
                  <p style={{ margin: '2px 0', color: '#64748b' }}>
                    {selectedAppointment.createdAt ? new Date(selectedAppointment.createdAt).toLocaleString() : '—'}
                  </p>
                </div>
              </div>

              {selectedAppointment.notes && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
                  <span className="stat-label">Clinical Notes / Reason</span>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#334155', background: '#f8fafc', padding: 10, borderRadius: 8 }}>
                    {selectedAppointment.notes}
                  </p>
                </div>
              )}
            </Card>
          </>
        )}
      </Drawer>

      {/* 6-STEP APPOINTMENT BOOKING WIZARD MODAL */}
      <Modal
        isOpen={isBookingModalOpen}
        onClose={() => setIsBookingModalOpen(false)}
        maxWidth="680px"
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#f0fdfa', color: '#0d9488', display: 'grid', placeItems: 'center' }}>
              <Icon name="calendar" size={18} />
            </div>
            <div>
              <span style={{ fontWeight: 800, fontSize: '17px' }}>Book Clinic Appointment</span>
              <span style={{ display: 'block', fontSize: '11px', color: '#64748b', fontWeight: 500 }}>
                Step {wizardStep} of 6: {
                  wizardStep === 1 ? 'Patient Selection' :
                  wizardStep === 2 ? 'Select Department' :
                  wizardStep === 3 ? 'Choose Physician' :
                  wizardStep === 4 ? 'Select Date' :
                  wizardStep === 5 ? 'Available Time Slot' :
                  'Review & Confirm'
                }
              </span>
            </div>
          </div>
        }
        footer={
          !bookingCompletedApt && (
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
              <Button
                variant="secondary"
                disabled={wizardStep === 1 || bookingSubmitting}
                onClick={() => setWizardStep(s => Math.max(1, s - 1))}
              >
                <Icon name="chevron-left" size={14} />
                <span>Back</span>
              </Button>

              <div style={{ display: 'flex', gap: 10 }}>
                <Button
                  variant="ghost"
                  onClick={() => setIsBookingModalOpen(false)}
                >
                  Cancel
                </Button>

                {wizardStep < 6 ? (
                  <Button
                    variant="primary"
                    disabled={
                      (wizardStep === 1 && !wizardPatient) ||
                      (wizardStep === 3 && !wizardDoctor) ||
                      (wizardStep === 4 && !wizardDate) ||
                      (wizardStep === 5 && !wizardSlot)
                    }
                    onClick={() => setWizardStep(s => Math.min(6, s + 1))}
                  >
                    <span>Next</span>
                    <Icon name="chevron-right" size={14} />
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    disabled={bookingSubmitting}
                    onClick={handleSubmitBooking}
                  >
                    {bookingSubmitting ? (
                      <span>Reserving Slot…</span>
                    ) : (
                      <>
                        <Icon name="check" size={16} />
                        <span>Confirm & Book Appointment</span>
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          )
        }
      >
        {bookingCompletedApt ? (
          /* SUCCESS SCREEN AFTER BOOKING */
          <div style={{ textAlign: 'center', padding: '24px 12px' }}>
            <div style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: '#ecfdf5',
              color: '#059669',
              display: 'grid',
              placeItems: 'center',
              margin: '0 auto 16px'
            }}>
              <Icon name="check" size={36} />
            </div>
            <h3 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 6px', color: '#0f172a' }}>
              Appointment Confirmed!
            </h3>
            <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 20px' }}>
              Your appointment reservation has been safely recorded in the clinic engine.
            </p>

            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              padding: '18px 24px',
              textAlign: 'left',
              display: 'grid',
              gap: 10,
              fontSize: '13px',
              marginBottom: 24
            }}>
              <div>👤 <b>Patient:</b> {bookingCompletedApt.patientName}</div>
              <div>🩺 <b>Doctor:</b> Dr. {bookingCompletedApt.doctorName} ({bookingCompletedApt.doctorSpecialization})</div>
              <div>📅 <b>Date & Time:</b> {bookingCompletedApt.date} at {bookingCompletedApt.startTime} {bookingCompletedApt.endTime ? `– ${bookingCompletedApt.endTime}` : ''}</div>
              <div>📍 <b>Consultation Room:</b> {bookingCompletedApt.doctorRoom || 'Room 101'}</div>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <Button
                variant="primary"
                onClick={() => {
                  setIsBookingModalOpen(false);
                  handleOpenDetails(bookingCompletedApt);
                }}
              >
                <span>View Appointment</span>
              </Button>
              <Button
                variant="secondary"
                onClick={() => setIsBookingModalOpen(false)}
              >
                <span>Close</span>
              </Button>
            </div>
          </div>
        ) : (
          <div>
            {/* WIZARD STEP INDICATOR */}
            <div className="wizard-steps-indicator">
              {[1, 2, 3, 4, 5, 6].map((s) => (
                <div
                  key={s}
                  className={`wizard-step-node ${wizardStep === s ? 'active' : wizardStep > s ? 'completed' : ''}`}
                >
                  <div className="wizard-step-circle">
                    {wizardStep > s ? '✓' : s}
                  </div>
                  <span className="wizard-step-label">
                    {s === 1 ? 'Patient' : s === 2 ? 'Dept' : s === 3 ? 'Doctor' : s === 4 ? 'Date' : s === 5 ? 'Slot' : 'Confirm'}
                  </span>
                </div>
              ))}
            </div>

            {/* STEP 1: PATIENT SELECTION */}
            {wizardStep === 1 && (
              <div>
                <h4 style={{ margin: '0 0 8px' }}>Select Patient</h4>
                <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#64748b' }}>
                  {profile?.role === 'PATIENT'
                    ? 'Book for yourself or choose a registered family member:'
                    : 'Search for an existing patient or enter patient ID:'}
                </p>

                {profile?.role === 'PATIENT' ? (
                  <div>
                    <div className="family-member-pills">
                      {familyMembers.map((member) => {
                        const isSelected = wizardPatient?.id === member.patientId;
                        return (
                          <div
                            key={member.id}
                            className={`family-member-pill ${isSelected ? 'selected' : ''}`}
                            onClick={() => setWizardPatient({
                              id: member.patientId,
                              name: member.name,
                              phone: member.phone,
                              age: member.age,
                              gender: member.gender
                            })}
                          >
                            <Icon name="user" size={14} />
                            <span>{member.name} ({member.relationship})</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div>
                    <input
                      type="text"
                      placeholder="Type patient name or phone to search…"
                      value={patientSearchTerm}
                      onChange={(e) => void handleSearchPatients(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        marginBottom: 12
                      }}
                    />

                    {searchingPatients && <p className="muted">Searching clinic records…</p>}

                    {patientSearchResults.length > 0 ? (
                      <div style={{ display: 'grid', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                        {patientSearchResults.map((p) => {
                          const isSelected = wizardPatient?.id === p.id;
                          return (
                            <div
                              key={p.id}
                              onClick={() => setWizardPatient({ id: p.id, name: p.name, phone: p.phone, age: p.age, gender: p.gender })}
                              style={{
                                padding: '10px 14px',
                                borderRadius: 8,
                                border: `1px solid ${isSelected ? '#0d9488' : '#e2e8f0'}`,
                                background: isSelected ? '#f0fdfa' : '#fff',
                                cursor: 'pointer',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                              }}
                            >
                              <div>
                                <b style={{ fontSize: '13.5px' }}>{p.name}</b>
                                <small style={{ display: 'block', color: '#64748b' }}>
                                  ID: {p.id} · Phone: {p.phone || '—'} · {p.age}y
                                </small>
                              </div>
                              {isSelected && <Badge tone="teal">Selected</Badge>}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ background: '#f8fafc', padding: 14, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                        <label style={{ display: 'grid', gap: 6, fontSize: '12.5px', fontWeight: 600 }}>
                          Or directly enter Patient ID:
                          <input
                            type="text"
                            placeholder="e.g. p-1002"
                            value={wizardPatient?.id || ''}
                            onChange={(e) => setWizardPatient({ id: e.target.value.trim(), name: 'Patient ' + e.target.value.trim() })}
                            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #cbd5e1' }}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* STEP 2: SPECIALIZATION SELECTION */}
            {wizardStep === 2 && (
              <div>
                <h4 style={{ margin: '0 0 8px' }}>Select Medical Department</h4>
                <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#64748b' }}>
                  Filter physicians by healthcare specialty:
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
                  <div
                    onClick={() => setWizardSpecialization('ALL')}
                    style={{
                      padding: 14,
                      borderRadius: 10,
                      border: `2px solid ${wizardSpecialization === 'ALL' ? '#0d9488' : '#e2e8f0'}`,
                      background: wizardSpecialization === 'ALL' ? '#f0fdfa' : '#fff',
                      cursor: 'pointer',
                      textAlign: 'center'
                    }}
                  >
                    <b style={{ fontSize: '14px', color: '#0f172a' }}>All Specialties</b>
                    <small style={{ display: 'block', color: '#64748b', marginTop: 4 }}>
                      {doctors.length} Doctors available
                    </small>
                  </div>

                  {specializations.map((spec) => {
                    const isSelected = wizardSpecialization.toLowerCase() === spec.toLowerCase();
                    const docCount = doctors.filter(d => (d.specialization || '').toLowerCase() === spec.toLowerCase()).length;
                    return (
                      <div
                        key={spec}
                        onClick={() => setWizardSpecialization(spec)}
                        style={{
                          padding: 14,
                          borderRadius: 10,
                          border: `2px solid ${isSelected ? '#0d9488' : '#e2e8f0'}`,
                          background: isSelected ? '#f0fdfa' : '#fff',
                          cursor: 'pointer',
                          textAlign: 'center'
                        }}
                      >
                        <b style={{ fontSize: '14px', color: '#0f172a' }}>{spec}</b>
                        <small style={{ display: 'block', color: '#64748b', marginTop: 4 }}>
                          {docCount} {docCount === 1 ? 'Doctor' : 'Doctors'}
                        </small>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* STEP 3: DOCTOR SELECTION */}
            {wizardStep === 3 && (
              <div>
                <h4 style={{ margin: '0 0 8px' }}>Choose Attending Physician</h4>
                <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#64748b' }}>
                  Select the doctor you wish to book with:
                </p>

                <div className="doctor-cards-grid">
                  {wizardFilteredDoctors.map((doc) => {
                    const isSelected = (wizardDoctor?.uid || wizardDoctor?.id) === (doc.uid || doc.id);
                    return (
                      <div
                        key={doc.uid || doc.id}
                        className={`doctor-select-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => setWizardDoctor(doc)}
                      >
                        <div className="doctor-select-card-head">
                          <div className="doctor-avatar-circle">
                            {doc.name.slice(0, 1).toUpperCase()}
                          </div>
                          <div>
                            <b style={{ fontSize: '14px' }}>Dr. {doc.name}</b>
                            <span style={{ display: 'block', fontSize: '12px', color: '#0f766e', fontWeight: 600 }}>
                              {doc.specialization || 'General Practitioner'}
                            </span>
                          </div>
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                          <span>📍 {doc.room || 'Room 101'}</span>
                          {doc.onDuty !== false && (
                            <span style={{ color: '#059669', fontWeight: 600 }}>● On Duty</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* STEP 4: DATE SELECTION */}
            {wizardStep === 4 && (
              <div>
                <h4 style={{ margin: '0 0 8px' }}>Select Consultation Date</h4>
                <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#64748b' }}>
                  Choose an upcoming date for Dr. {wizardDoctor?.name}:
                </p>

                {/* Quick Date Pills */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                  {next7Days.map(({ dateStr, label, weekday }) => {
                    const isSelected = wizardDate === dateStr;
                    return (
                      <button
                        key={dateStr}
                        onClick={() => setWizardDate(dateStr)}
                        style={{
                          padding: '10px 14px',
                          borderRadius: 10,
                          border: `2px solid ${isSelected ? '#0d9488' : '#e2e8f0'}`,
                          background: isSelected ? '#0d9488' : '#fff',
                          color: isSelected ? '#fff' : '#0f172a',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 2,
                          cursor: 'pointer'
                        }}
                      >
                        <span style={{ fontSize: '11px', textTransform: 'uppercase', opacity: 0.85 }}>{weekday}</span>
                        <b style={{ fontSize: '14px' }}>{label}</b>
                      </button>
                    );
                  })}
                </div>

                <label style={{ display: 'grid', gap: 6, fontSize: '13px', fontWeight: 600 }}>
                  Or select custom date:
                  <input
                    type="date"
                    min={todayStr}
                    value={wizardDate}
                    onChange={(e) => setWizardDate(e.target.value)}
                    style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1' }}
                  />
                </label>
              </div>
            )}

            {/* STEP 5: TIME SLOT SELECTION */}
            {wizardStep === 5 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ margin: 0 }}>Available Time Slots</h4>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>
                      Dr. {wizardDoctor?.name} · {wizardDate}
                    </span>
                  </div>

                  {availability && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span className="badge teal">{availability.remaining} available</span>
                      <span className="badge neutral">{availability.booked} booked</span>
                    </div>
                  )}
                </div>

                {loadingSlots ? (
                  <p className="muted" style={{ marginTop: 24, textAlign: 'center' }}>
                    Querying real-time schedule slots from C++ engine…
                  </p>
                ) : availability?.available === false ? (
                  <div style={{
                    marginTop: 20,
                    padding: 16,
                    background: '#fff1f2',
                    border: '1px solid #fecdd3',
                    borderRadius: 8,
                    color: '#e11d48',
                    fontSize: '13px'
                  }}>
                    <b>Doctor is not available on this date:</b> {availability.reason || 'Off duty or leave'}
                  </div>
                ) : !availability?.slots || availability.slots.length === 0 ? (
                  <div style={{
                    marginTop: 20,
                    padding: 16,
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: 8,
                    color: '#b45309',
                    fontSize: '13px'
                  }}>
                    All slots are fully booked for this date. Please select another date.
                  </div>
                ) : (
                  <div className="slots-grid">
                    {availability.slots.map((slot) => {
                      const isSelected = wizardSlot === slot;
                      return (
                        <button
                          key={slot}
                          type="button"
                          className={`slot-pill-btn ${isSelected ? 'selected' : ''}`}
                          onClick={() => setWizardSlot(slot)}
                        >
                          {slot}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* STEP 6: REVIEW & CONFIRM */}
            {wizardStep === 6 && (
              <div>
                <h4 style={{ margin: '0 0 14px' }}>Review & Confirm Booking</h4>

                <div style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  padding: '16px 20px',
                  display: 'grid',
                  gap: 12,
                  fontSize: '13.5px',
                  marginBottom: 16
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
                    <span style={{ color: '#64748b' }}>Patient</span>
                    <b>{wizardPatient?.name} (#{wizardPatient?.id})</b>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
                    <span style={{ color: '#64748b' }}>Physician</span>
                    <b>Dr. {wizardDoctor?.name} ({wizardDoctor?.specialization})</b>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
                    <span style={{ color: '#64748b' }}>Date & Slot</span>
                    <b style={{ color: '#0f766e' }}>{wizardDate} at {wizardSlot}</b>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#64748b' }}>Consultation Room</span>
                    <span>{wizardDoctor?.room || 'Room 101'}</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gap: 14 }}>
                  <label style={{ display: 'grid', gap: 6, fontSize: '13px', fontWeight: 600 }}>
                    Priority
                    <select
                      value={wizardPriority}
                      onChange={(e) => setWizardPriority(e.target.value as Priority)}
                      style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1' }}
                    >
                      <option value="NORMAL">Normal Priority</option>
                      <option value="EMERGENCY">Emergency Priority (Urgent)</option>
                    </select>
                  </label>

                  <label style={{ display: 'grid', gap: 6, fontSize: '13px', fontWeight: 600 }}>
                    Notes / Reason for visit (optional)
                    <textarea
                      placeholder="Brief description of symptoms, routine checkup, or notes…"
                      value={wizardNotes}
                      onChange={(e) => setWizardNotes(e.target.value)}
                      rows={3}
                      style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', resize: 'vertical' }}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* CHECK-IN MODAL */}
      <Modal
        isOpen={!!checkinModalAppointment}
        onClose={() => setCheckinModalAppointment(null)}
        title="Check-In Patient to Queue"
        footer={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setCheckinModalAppointment(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!!processingId}
              onClick={handleConfirmCheckin}
            >
              <Icon name="check" size={16} />
              <span>Generate Queue Token</span>
            </Button>
          </div>
        }
      >
        {checkinModalAppointment && (
          <div>
            <p style={{ margin: '0 0 16px', fontSize: '14px' }}>
              Confirm check-in for <b>{checkinModalAppointment.patientName}</b> for their consultation with Dr. {checkinModalAppointment.doctorName}.
            </p>

            <div style={{ background: '#f8fafc', padding: 14, borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 16 }}>
              <div>📅 <b>Scheduled Time:</b> {checkinModalAppointment.startTime}</div>
              <div>📍 <b>Date:</b> {checkinModalAppointment.date}</div>
              <div>🩺 <b>Doctor:</b> Dr. {checkinModalAppointment.doctorName}</div>
            </div>

            <label style={{ display: 'grid', gap: 6, fontSize: '13px', fontWeight: 600 }}>
              Queue Priority Level
              <select
                value={checkinPriority}
                onChange={(e) => setCheckinPriority(e.target.value as Priority)}
                style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1' }}
              >
                <option value="NORMAL">NORMAL (Standard FIFO Queue)</option>
                <option value="SENIOR">SENIOR (Senior Citizen 60+ Priority)</option>
                <option value="EMERGENCY">EMERGENCY (Immediate Top Priority)</option>
              </select>
            </label>
          </div>
        )}
      </Modal>

      {/* CANCEL APPOINTMENT CONFIRMATION MODAL */}
      <Modal
        isOpen={!!cancelModalAppointment}
        onClose={() => setCancelModalAppointment(null)}
        title="Cancel Appointment"
        footer={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setCancelModalAppointment(null)}>
              Keep Appointment
            </Button>
            <Button
              variant="danger"
              disabled={!!processingId}
              onClick={handleConfirmCancel}
            >
              <span>Yes, Cancel Appointment</span>
            </Button>
          </div>
        }
      >
        {cancelModalAppointment && (
          <div>
            <p style={{ margin: '0 0 14px', fontSize: '14px', color: '#1e293b' }}>
              Are you sure you want to cancel the appointment for <b>{cancelModalAppointment.patientName}</b>?
            </p>
            <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', padding: 12, borderRadius: 8, fontSize: '13px', color: '#e11d48' }}>
              This will release the reserved consultation slot ({cancelModalAppointment.date} at {cancelModalAppointment.startTime}) and cancel any active queue tokens.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
