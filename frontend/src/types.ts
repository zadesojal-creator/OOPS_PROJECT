export type Role = 'ADMIN' | 'DOCTOR' | 'RECEPTIONIST' | 'PATIENT';

export type Priority = 'EMERGENCY' | 'SENIOR' | 'NORMAL';

export type UserProfile = {
  uid: string;
  name: string;
  email: string;
  role: Role;
  patientId?: string;
  onDuty?: boolean;
  specialization?: string;
};

export type QueueToken = {
  id: string;
  tokenNumber: string;
  patientId: string;
  patientName: string;
  patientPhone?: string;
  patientAge?: number;
  patientGender?: string;
  doctorId?: string;
  doctorName?: string;
  doctorSpecialization?: string;
  doctorRoom?: string;
  priority: Priority;
  status: 'WAITING' | 'CALLED' | 'COMPLETED' | 'CANCELLED';
  position?: number;
  aheadCount?: number;
  estimatedWaitMinutes?: number;
  createdAt: string;
  calledAt?: string;
  calledBy?: string;
};

export type Patient = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  age: number;
  gender: string;
  notes?: string;
  telegramChatId?: string | number;
  telegramLinked?: boolean;
  telegramLinkedAt?: string;
  createdAt?: string;
  consultations?: Consultation[];
  prescriptions?: Prescription[];
  walkInToken?: QueueToken;
  appointment?: Appointment;
};

export type Consultation = {
  id: string;
  queueId?: string | null;
  appointmentId?: string | null;
  patientId: string;
  patientName: string;
  diagnosis: string;
  notes: string;
  doctorId: string;
  doctorName: string;
  doctorSpecialization?: string;
  createdAt: string;
};

export type Medication = {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions?: string;
};

export type TelegramDeliveryStatus = {
  status: 'SENT' | 'FAILED' | 'NOT_LINKED' | 'TELEGRAM_NOT_CONFIGURED' | 'PENDING';
  sentAt?: string;
  triedAt?: string;
  chatId?: string | number;
  recipientPhone?: string;
  recipientName?: string;
  error?: string;
};

export type EmailDeliveryStatus = {
  status: 'SENT' | 'FAILED' | 'PENDING' | 'NOT_SENT';
  sentAt?: string;
  triedAt?: string;
  recipientEmail?: string;
  messageId?: string;
  error?: string;
};

export type Prescription = {
  id: string;
  consultationId: string;
  appointmentId?: string;
  patientId: string;
  patientName: string;
  doctorId?: string;
  doctorName?: string;
  doctorSpecialization?: string;
  diagnosis?: string;
  medications?: Medication[];
  instructions?: string;
  followUpDate?: string;
  fileName: string;
  mimeType: 'application/pdf';
  sizeBytes: number;
  downloadUrl: string;
  telegramDelivery?: TelegramDeliveryStatus;
  emailDelivery?: EmailDeliveryStatus;
  createdAt: string;
};

export type DashboardStats = {
  waiting: number;
  completed: number;
  emergency: number;
  senior?: number;
  doctorsAvailable: number;
  myAppointmentsToday?: number;
  onDuty?: boolean;
};

export type AppointmentStatus = 'BOOKED' | 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export type CheckInStatus = 'NOT_ARRIVED' | 'CHECKED_IN';

export type Appointment = {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone?: string;
  patientAge?: number;
  patientGender?: string;
  doctorId: string;
  doctorName: string;
  doctorSpecialization?: string;
  doctorRoom?: string;
  date: string;
  startTime: string;
  endTime?: string;
  startAt?: string;
  endAt?: string;
  status: AppointmentStatus;
  checkInStatus?: CheckInStatus;
  priority?: Priority;
  notes?: string;
  source?: string;
  createdAt: string;
  updatedAt?: string;
  queueId?: string;
  queueToken?: string;
  checkedInAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  queue?: QueueToken;
};

export type FamilyMember = {
  id: string;
  patientId: string;
  name: string;
  age?: number;
  gender?: string;
  phone?: string;
  relationship: string;
  isVerified: boolean;
};

export type DoctorSchedule = {
  doctorId: string;
  workingDays: number[];
  startTime: string;
  endTime: string;
  lunchStart: string;
  lunchEnd: string;
  slotDurationMinutes: number;
  maxAppointments: number;
};

export type DoctorHoliday = {
  id: string;
  doctorId: string;
  date: string;
  reason: string;
};

export type AvailableSlotResponse = {
  slots: string[];
  totalSlots: number;
  booked: number;
  remaining: number;
  maxAppointments: number;
  available?: boolean;
  reason?: string;
};

// Admin Doctor-Wise Patient Management Types
export type DoctorWisePatient = {
  id: string;
  name: string;
  phone: string;
  age: number;
  gender: string;
  totalVisits: number;
  lastVisitDate: string;
  recentStatus: string;
};

export type DoctorWiseItem = {
  id: string;
  name: string;
  email: string;
  specialization: string;
  room: string;
  fee: string;
  onDuty: boolean;
  schedule: DoctorSchedule;
  metrics: {
    uniquePatientsCount: number;
    totalVisitsCount: number;
    todayAppointmentsCount: number;
    waitingCount: number;
    inConsultationCount: number;
    completedCount: number;
    cancelledCount: number;
  };
  patients: DoctorWisePatient[];
  recentConsultations: Consultation[];
};

// Patient Dashboard Data Types
export type ActiveQueueInfo = QueueToken & {
  position: number;
  aheadCount: number;
  estimatedWaitMinutes?: number;
  message?: string;
};

export type PatientDashboardData = {
  patient: {
    id: string;
    name: string;
    phone: string;
    age: number;
    gender: string;
    email: string;
  };
  activeQueue: ActiveQueueInfo | null;
  upcomingAppointments: Appointment[];
  pastAppointments: Appointment[];
  consultations: Consultation[];
  groupedConsultations: { [doctorName: string]: Consultation[] };
  prescriptions: Prescription[];
  telegram: {
    isLinked: boolean;
    chatIdMasked: string;
    linkedAt: string | null;
    deliveries: any[];
  };
};
