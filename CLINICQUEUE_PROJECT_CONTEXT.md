# ClinicQueue — Master Architecture, Logic & System Specification

> **AI AGENT SYSTEM PROMPT / CONTEXT INJECTION:**
> You are an expert full-stack healthcare software architect and engineer assisting with the **ClinicQueue** codebase. This document contains the complete, verified, ground-truth technical specification, database schema, domain business logic, IPC protocols, and development rules for this project.
> 
> When answering questions, diagnosing issues, or generating code, **strictly adhere to the architecture, constraints, and conventions detailed below**. Do not hallucinate mock data, do not introduce Docker, do not delete existing features, and do not break the C++ engine or multi-doctor data relationships.

---

## 1. Executive Project Summary

**ClinicQueue** is an enterprise-grade, multi-tier outpatient healthcare operations and clinic management platform. It coordinates patient registration, medical specialization routing, deterministic priority queue triage, conflict-free appointment booking, physician consultation recording, prescription PDF generation, automatic Telegram delivery, and an AI-powered clinical knowledge base.

### Key Capabilities
1. **Receptionist Intake & Doctor Selection**: Register walk-in patients or book scheduled appointments with live doctor selection filtered by medical specialization, including automatic age 60+ senior citizen priority recommendations.
2. **Deterministic Priority Queue**: Implements an `Emergency (0) -> Senior 60+ (1) -> Normal (2)` priority policy with strict FIFO within each tier, computed and enforced via a pure C++17 engine.
3. **Conflict-Free Appointment Engine**: Computes available consultation time slots dynamically using half-open time intervals `[start, end)`, doctor shift hours, lunch breaks, holiday schedules, and existing bookings.
4. **Physician Consultation & Prescription Delivery**: Doctors conduct consultations, write structured prescriptions, download branded PDF records, and automatically deliver them to the patient's verified Telegram account.
5. **Multi-Member Telegram Bot (`@Clinical_oops_bot`)**: Enables patients to manage multiple family members under a single Telegram account, book appointments, track live queue tokens (`#X in queue`), receive prescription PDFs, and query the clinic AI FAQ.
6. **Clinical AI & RAG FAQ Microservice**: BM25 document retrieval combined with Groq neural LLM inference answering clinic queries from indexed hospital guides.
7. **Role-Based Access Control (RBAC)**: Distinct, secure workspaces for `ADMIN`, `DOCTOR`, `RECEPTIONIST`, and `PATIENT`.

---

## 2. System Architecture & Tech Stack

```
                              ┌────────────────────────────────────────┐
                              │          React 19 + Vite Web           │
                              │     (Healthcare SaaS Custom UI)        │
                              └───────────────────┬────────────────────┘
                                                  │ /api proxy (port 5173 -> 3000)
                                                  ▼
┌──────────────────────┐      ┌────────────────────────────────────────┐      ┌──────────────────────┐
│  Telegram Bot API    │◄────►│       Node.js + Express API            │◄────►│  FastAPI AI Service  │
│ (@Clinical_oops_bot) │      │ (TypeScript, Port 3000, Auth Boundary) │      │  (Python, Port 8001) │
└──────────────────────┘      └───────────┬────────────────┬───────────┘      └──────────┬───────────┘
                                          │                │                             │
                     Child Process (stdio)│                │Firebase Admin SDK           │BM25 + Groq API
                                          ▼                ▼                             ▼
                              ┌────────────────┐   ┌───────────────┐           ┌─────────────────────┐
                              │  C++17 Engine  │   │ Cloud Google  │           │   Clinic Knowledge  │
                              │ (Native Binary │   │   Firestore   │           │   Markdown Store    │
                              │  IPC Protocol) │   │ & Firebase Auth           │ (hospital_info.md)  │
                              └────────────────┘   └───────────────┘           └─────────────────────┘
```

### Architectural Tiers

| Tier | Technology | Directory | Port / Runtime | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend** | React 19, TypeScript, Vite | `frontend/` | `http://localhost:5173` | Responsive web dashboard, intake wizard, appointment scheduler, live queue. |
| **Integration API** | Node.js 20+, Express, TypeScript | `integration/` | `http://localhost:3000` | REST API, RBAC, Firebase Admin boundary, PDFKit generation, Telegram bot polling. |
| **Core Domain Engine**| Pure C++17 OOP, CMake, `nlohmann/json` | `cpp-core/` | Executable binary IPC (`clinicqueue-engine.exe`) | Deterministic queue ordering, conflict-safe slot generation, capacity rules. |
| **Clinical AI Service**| Python 3.11+, FastAPI, Uvicorn | `ai-service/` | `http://127.0.0.1:8001` | Symptom specialization routing, BM25 chunk search, Groq LLM RAG synthesis. |
| **Database & Auth** | Google Cloud Firestore + Firebase Auth | Managed Cloud | Cloud Firestore | Persistent document database and user authentication. |
| **Telegram Bot** | `node-telegram-bot-api` | `integration/src/telegram/` | Polling daemon inside Node.js | Multi-member family registration, booking, status tracking, prescription delivery, FAQ. |

---

## 3. Directory & File Inventory

```
ClinicQueue-Final-Formatted/
├── frontend/                              # Web Application Client
│   ├── src/
│   │   ├── main.tsx                       # React application bootstrap
│   │   ├── App.tsx                        # Router & route definitions
│   │   ├── styles.css                     # Complete SaaS design system (navy/teal, cards, badges)
│   │   ├── types.ts                       # Frontend TypeScript type declarations
│   │   ├── components/
│   │   │   ├── Layout.tsx                 # App shell, collapsible sidebar, health pill, topbar
│   │   │   ├── Ui.tsx                     # StatCard, Card, Badge, Button, Modal, Drawer, EmptyState
│   │   │   └── Icon.tsx                   # Lucide-style SVG icon library
│   │   ├── context/
│   │   │   └── AuthContext.tsx            # Firebase Auth listener, token storage, user profile state
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx              # Role-aware dashboard (Doctor, Receptionist, Admin)
│   │   │   ├── Patients.tsx               # Composite intake (Walk-in, Appointment, Profile Only)
│   │   │   ├── Appointments.tsx           # Appointment management table, details drawer, 6-step wizard
│   │   │   ├── Queue.tsx                  # Live priority queue table, #1 Next badge, call/cancel actions
│   │   │   ├── Consultation.tsx           # Physician workspace, diagnoses, Rx builder, Telegram sender
│   │   │   ├── PatientDashboard.tsx       # Patient personal portal, family members, Telegram link code
│   │   │   ├── Login.tsx                  # Authentication screen with demo role autofill buttons
│   │   │   └── Settings.tsx               # Admin clinic configuration & role assignment
│   │   └── services/
│   │       └── api.ts                     # Axios client with Firebase Bearer token injection
│   ├── package.json
│   └── vite.config.ts                     # Proxies /api to http://localhost:3000
│
├── integration/                           # Backend Integration Layer
│   ├── src/
│   │   ├── app.ts                         # Express server setup, routes, Telegram bot initialization
│   │   ├── firebase/
│   │   │   └── admin.ts                   # Firebase Admin SDK init, Firestore db handle, doc formatter
│   │   ├── middleware/
│   │   │   └── auth.ts                    # `authenticate` & `authorize(['ADMIN', 'DOCTOR', ...])`
│   │   ├── cpp-adapter/
│   │   │   └── CppEngine.ts               # Child process spawn bridge to clinicqueue-engine.exe
│   │   ├── routes/
│   │   │   ├── appointments.ts            # CRUD, available slots via C++, atomic booking, checkin, cancel
│   │   │   ├── dashboard.ts               # Stats, doctor-wise metrics, doctor-summary
│   │   │   ├── doctors.ts                 # Doctors list, specialization filtering, onDuty check, schedules
│   │   │   ├── patients.ts                # Composite patient intake, walk-in token creation
│   │   │   ├── queue.ts                   # Queue endpoints, orderQueue via C++, token calling, PATCH cancel
│   │   │   ├── consultations.ts           # Consultation creation and history retrieval
│   │   │   ├── prescriptions.ts           # Prescription creation, PDFKit generation, Telegram delivery
│   │   │   ├── patientPortal.ts           # Patient self-service endpoints, link code generator, family
│   │   │   ├── auth.ts                    # User profile endpoint, role assignment
│   │   │   └── specializations.ts        # Dynamic medical specialization discovery
│   │   ├── services/
│   │   │   └── pdf.ts                     # Medical prescription PDF layout generator (PDFKit)
│   │   └── telegram/
│   │       ├── bot.ts                     # Telegram bot instance, message router, update deduplication
│   │       ├── ui.ts                      # Custom Telegram reply markup keyboards
│   │       ├── commands/
│   │       │   ├── start.ts               # /start welcome message, account creation, family summary
│   │       │   └── faq.ts                 # Clinical RAG query handler & fallback knowledge
│   │       ├── services/
│   │       │   ├── FamilyService.ts       # Multi-member account manager, patient linking, phone resolution
│   │       │   └── SessionService.ts      # Conversational multi-step state machine in Firestore
│   │       └── workflows/
│   │           ├── RegistrationWorkflow.ts# Step-by-step patient registration wizard & link codes
│   │           ├── BookingWorkflow.ts     # Step-by-step appointment booking wizard via Telegram
│   │           └── QueueWorkflow.ts       # Live queue token status, request, and cancel
│   ├── storage/
│   │   └── prescriptions/                 # Local directory where generated prescription PDFs are saved
│   └── package.json
│
├── cpp-core/                              # Core Domain Engine (Native C++17)
│   ├── include/
│   │   ├── Models.hpp                     # Structs: Appointment, Schedule, QueueToken, Holiday
│   │   ├── AppointmentEngine.hpp          # Conflict checks, half-open intervals, slot generator
│   │   └── QueueEngine.hpp                # Priority comparator (Emergency > Senior > Normal, FIFO)
│   ├── src/
│   │   ├── main.cpp                       # CLI entry point: reads JSON stdin, writes JSON stdout
│   │   ├── AppointmentEngine.cpp          # Slot computation logic
│   │   └── QueueEngine.cpp                # Sorting algorithms
│   ├── build/Debug/
│   │   └── clinicqueue-engine.exe         # Compiled native Windows binary
│   └── CMakeLists.txt
│
├── ai-service/                            # Clinical AI & RAG Microservice (Python FastAPI)
│   ├── app/
│   │   ├── main.py                        # FastAPI application entry point, CORS, routers
│   │   ├── api/
│   │   │   ├── health.py                  # GET /health
│   │   │   ├── rag.py                     # POST /rag/query, POST /rag/ingest, GET /rag/documents
│   │   │   ├── nlp.py                     # POST /nlp/specialization (symptom mapping)
│   │   │   └── prescription.py            # Clinical prescription assistance
│   │   ├── services/
│   │   │   ├── rag_service.py             # BM25 token ranker + Groq neural LLM synthesis
│   │   │   └── document_service.py        # Markdown/PDF text extraction and chunk indexing
│   │   └── models/
│   │       └── schemas.py                 # Pydantic request/response schemas
│   ├── data/
│   │   └── clinic_knowledge/              # Knowledge files indexed for RAG
│   │       ├── hospital_information.md    # Hospital hours, fees, departments, triage rules
│   │       └── doctors_directory.md       # Physician roster, specializations, cabins
│   ├── requirements.txt
│   └── .env                               # Groq API configuration
│
└── start-all.ps1                          # PowerShell script to launch all 3 services simultaneously
```

---

## 4. Firestore Database Schema & Data Models

### 1. `users` Collection
Stores authenticated staff profiles (Admin, Doctor, Receptionist) and patients.
```json
{
  "uid": "FIREBASE_AUTH_UID",
  "name": "Dr. Priya Patel",
  "email": "doctor@gmail.com",
  "role": "DOCTOR",              // Enum: 'ADMIN' | 'DOCTOR' | 'RECEPTIONIST' | 'PATIENT'
  "active": true,
  "onDuty": true,                 // Boolean: Duty status for receiving patients
  "specialization": "Cardiologist",
  "room": "Cabin 102, 1st Floor",
  "fee": "$50",
  "phone": "+15550192834",
  "createdAt": "2026-10-10T08:00:00.000Z"
}
```

### 2. `patients` Collection
Represents patient demographic profiles.
> **CRITICAL RULE**: Patients have a stable, auto-generated `patientId` (e.g., `PAT-1082`). Patients are **NEVER** identified solely by phone number, and patient documents are **NEVER permanently bound to a single doctor**.
```json
{
  "id": "PAT-1082",
  "name": "Arun Kumar",
  "phone": "+919876543210",
  "age": 63,
  "gender": "Male",               // Enum: 'Male' | 'Female' | 'Other'
  "relationship": "Self",         // Family relationship: 'Self' | 'Spouse' | 'Child' | 'Parent' | 'Other'
  "notes": "Mild hypertension history",
  "telegramChatId": 7967702570,    // Numeric Telegram chat ID if linked
  "telegramLinked": true,
  "telegramLinkedAt": "2026-10-11T12:00:00.000Z",
  "createdAt": "2026-10-11T09:30:00.000Z"
}
```

### 3. `appointments` Collection
Stores pre-scheduled specialist consultation bookings.
```json
{
  "id": "APT-9921",
  "doctorId": "DOCTOR_UID",
  "doctorName": "Dr. Priya Patel",
  "doctorSpecialization": "Cardiologist",
  "patientId": "PAT-1082",
  "patientName": "Arun Kumar",
  "patientPhone": "+919876543210",
  "date": "2026-10-21",           // String: 'YYYY-MM-DD'
  "startTime": "10:20",           // String: 'HH:mm'
  "endTime": "10:40",             // String: 'HH:mm' (computed from slotDurationMinutes)
  "startAt": "2026-10-21T10:20:00.000Z",
  "endAt": "2026-10-21T10:40:00.000Z",
  "durationMinutes": 20,
  "status": "BOOKED",             // Enum: 'BOOKED' | 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED'
  "checkInStatus": "NOT_ARRIVED", // Enum: 'NOT_ARRIVED' | 'CHECKED_IN'
  "queueToken": "T-3",            // String: Token assigned when patient checks in at reception
  "checkedInAt": "2026-10-21T10:15:00.000Z",
  "notes": "Chest heaviness evaluation",
  "createdAt": "2026-10-12T14:00:00.000Z",
  "updatedAt": "2026-10-21T10:15:00.000Z"
}
```

### 4. `queue` Collection
Live daily waiting room queue tokens.
```json
{
  "id": "QUEUE_DOC_ID",
  "tokenNumber": "T-3",
  "patientId": "PAT-1082",
  "patientName": "Arun Kumar",
  "patientPhone": "+919876543210",
  "patientAge": 63,
  "patientGender": "Male",
  "doctorId": "DOCTOR_UID",
  "doctorName": "Dr. Priya Patel",
  "doctorSpecialization": "Cardiologist",
  "doctorRoom": "Cabin 102",
  "priority": "SENIOR",           // Enum: 'EMERGENCY' | 'SENIOR' | 'NORMAL'
  "status": "WAITING",            // Enum: 'WAITING' | 'CALLED' | 'COMPLETED' | 'CANCELLED'
  "source": "APPOINTMENT",        // Enum: 'WALK_IN' | 'APPOINTMENT'
  "appointmentId": "APT-9921",
  "position": 1,                  // Number: 1-based live rank in waiting line
  "aheadCount": 0,
  "estimatedWaitMinutes": 15,
  "notes": "",
  "createdAt": "2026-10-21T10:15:00.000Z",
  "calledAt": null,
  "calledBy": null,
  "cancelledAt": null,
  "cancelledBy": null
}
```

### 5. `consultations` Collection
Clinical encounter records created by physicians.
```json
{
  "id": "CONSULT_DOC_ID",
  "queueId": "QUEUE_DOC_ID",
  "appointmentId": "APT-9921",
  "patientId": "PAT-1082",
  "patientName": "Arun Kumar",
  "doctorId": "DOCTOR_UID",
  "doctorName": "Dr. Priya Patel",
  "diagnosis": "Stage 1 Essential Hypertension with sinus tachycardia",
  "notes": "BP: 145/92 mmHg. Advised low sodium diet and 30 mins daily walking.",
  "prescriptionId": "RX_DOC_ID",
  "createdAt": "2026-10-21T10:35:00.000Z"
}
```

### 6. `prescriptions` Collection
Pharmacological prescriptions and PDF delivery logs.
```json
{
  "id": "RX_DOC_ID",
  "consultationId": "CONSULT_DOC_ID",
  "patientId": "PAT-1082",
  "patientName": "Arun Kumar",
  "doctorId": "DOCTOR_UID",
  "doctorName": "Dr. Priya Patel",
  "doctorSpecialization": "Cardiologist",
  "medications": [
    {
      "name": "Telmisartan 40mg",
      "dosage": "1 tablet",
      "frequency": "1-0-0",
      "duration": "30 days",
      "instructions": "Take once daily in the morning after breakfast"
    },
    {
      "name": "Metoprolol Succinate 25mg",
      "dosage": "1 tablet",
      "frequency": "0-0-1",
      "duration": "14 days",
      "instructions": "Take at night"
    }
  ],
  "instructions": "Review blood pressure after 14 days. Avoid high sodium foods.",
  "followUpDate": "2026-11-04",
  "pdfPath": "./storage/prescriptions/prescription_PAT-1082_1792211000.pdf",
  "telegramDelivery": {
    "sent": true,
    "chatId": 7967702570,
    "phoneMasked": "+9198****3210",
    "sentAt": "2026-10-21T10:38:15.000Z",
    "messageId": 412,
    "error": null
  },
  "createdAt": "2026-10-21T10:38:00.000Z"
}
```

### 7. `doctor_schedules` Collection
Work week rules and consultation capacity. Document ID matches `doctorId`.
```json
{
  "doctorId": "DOCTOR_UID",
  "workingDays": [1, 2, 3, 4, 5, 6], // Array: 0=Sun, 1=Mon, ..., 6=Sat
  "startTime": "09:00",
  "endTime": "17:00",
  "lunchStart": "13:00",
  "lunchEnd": "14:00",
  "slotDurationMinutes": 20,
  "maxAppointments": 20
}
```

### 8. `family_accounts` & `telegramSessions`
- `family_accounts/{chatId}`: Links multiple patient records under a single numeric Telegram `chatId`.
- `telegramSessions/{chatId}`: Multi-step conversation state machine storing active patient selection and step states (`FAM_REG_NAME`, `BOOKING_SLOT`, `FAQ_QUESTION`).

---

## 5. Pure C++17 Core Engine & IPC Protocol

The core logic engine (`cpp-core/build/Debug/clinicqueue-engine.exe`) is invoked as an isolated subprocess from Node.js via standard I/O (`stdin` / `stdout`).

```typescript
// Integration Bridge: integration/src/cpp-adapter/CppEngine.ts
const child = spawn(enginePath, []);
child.stdin.write(JSON.stringify({ operation: 'orderQueue', payload: { tokens } }));
```

### Operations Supported

#### 1. `orderQueue`
- **Rule**: Sorts queue tokens deterministically by:
  1. Priority level: `EMERGENCY (0)` > `SENIOR (1)` > `NORMAL (2)`
  2. Timestamp: Ascending FIFO `createdAt` ISO string
- **Constraint**: A doctor or receptionist calling a patient must call the top token (`ordered[0]`). If called out of order, the engine returns HTTP `409 Conflict: "Call the next patient in priority order"`.

#### 2. `generateSlots` (alias: `computeAvailableSlots`)
- **Input**: `schedule`, `bookedSlots`, `targetDate`, `nowUtc`.
- **Rule**: Generates half-open slot intervals `[start, end)`:
  - Skips slots occurring before `schedule.startTime` or after `schedule.endTime`.
  - Excludes slots overlapping lunch interval `[lunchStart, lunchEnd)`.
  - Excludes dates not present in `schedule.workingDays`.
  - Excludes already booked appointment slots (unless status is `CANCELLED`).
  - Skips past slots if `targetDate` is today.
  - Enforces capacity limit `schedule.maxAppointments`.

---

## 6. Business Logic & Core Workflows

### A. Receptionist Patient Intake (`frontend/src/pages/Patients.tsx`)
1. **Intake Modes**:
   - **Walk-in**: Assigns immediate daily queue ticket (`T-X`), requires consulting doctor selection.
   - **Appointment**: Selects specialization, eligible doctor, date, and conflict-free time slot.
   - **Profile Only**: Registers patient demographics without a visit token.
2. **Specialization & Doctor Filtering**:
   - Specialization dropdown dynamically filters eligible active physicians (`onDuty: true`).
   - Changing specialization clears any mismatched doctor selection.
   - Displays empty state if no active doctors are available for that specialty.
3. **Senior Citizen Prioritization**:
   - Patients aged 60 or above automatically default to **`SENIOR`** priority.
4. **Multi-Doctor Care Model**:
   - Patients can visit Dr. A (Cardiology) today and Dr. B (Dermatology) next week. Their profile remains global and is never locked to one doctor.

### B. Appointment Check-In Workflow
1. When an appointment patient arrives at the clinic, the receptionist clicks **Check In** on the dashboard or appointments table.
2. The backend (`POST /api/appointments/:id/checkin`):
   - Atomically updates appointment: `status = 'CHECKED_IN'`, `checkInStatus = 'CHECKED_IN'`.
   - Generates a live queue token in `queue` collection with priority determined by patient age/triage.
   - Links `queueToken: "T-X"` back to the appointment document.
   - Rejects duplicate check-in with `409 Conflict`.

### C. Physician Workspace & Telegram Delivery (`Consultation.tsx`)
1. Doctor clicks **Call Next** on their dashboard or `/queue`.
2. Token state updates to `CALLED`, active consultation banner appears.
3. Doctor examines patient, inputs diagnosis, notes, and builds medication rows.
4. Saving consultation:
   - Sets queue token to `COMPLETED`.
   - Generates PDF prescription using `pdfkit`.
   - Checks if patient's Telegram `chatId` is linked.
   - Automatically transmits the PDF file directly to the patient's Telegram chat.

### D. Telegram Bot Family System (`@Clinical_oops_bot`)
1. **Welcome (`/start`)**:
   - Obtains numeric Telegram `chatId` from update.
   - Displays family summary and main menu options:
     - `📝 Register a New Patient`
     - `👤 Select an Existing Patient`
     - `👨‍👩‍👧 My Family Members`
     - `📅 Book an Appointment`
     - `📊 Check Appointment / Token Status`
     - `❓ Help / Clinic FAQs`
2. **Family Registration**:
   - Prompts for Name, Age, Gender, Phone, and Relationship (`Self`, `Spouse`, `Child`, `Parent`, `Sibling`, `Other`).
   - Creates a new `patients` record with unique `patientId`. Multiple family members can share a single phone number without overwriting each other.
3. **Clinical AI RAG FAQ**:
   - Patient taps `❓ Help / Clinic FAQs` or types any question (e.g., *"Do you have ECG?"*, *"What are the fees?"*).
   - Node.js backend forwards query to Python FastAPI `/rag/query`.
   - BM25 ranker searches `hospital_information.md` and `doctors_directory.md`.
   - Groq neural LLM synthesizes structured markdown with bold headings and emojis.
   - Telegram delivers answer while keeping FAQ navigation active.

---

## 7. Role-Based Access Control (RBAC) Matrix

| Endpoint / Feature | `ADMIN` | `DOCTOR` | `RECEPTIONIST` | `PATIENT` |
| :--- | :---: | :---: | :---: | :---: |
| **View Dashboard** | Global + Doctor-wise metrics | Personal queue & schedule | Front-desk intake & queue | Personal patient portal |
| **Patient Registration** | ✅ Full | ❌ Read-only | ✅ Full with doctor selection | ✅ Telegram / Self |
| **Queue Management** | ✅ View & Cancel | ✅ Call Next & Consult | ✅ View, Intake & Cancel | ❌ Status only |
| **Consultation Recording** | ✅ | ✅ (Own patients) | ❌ | ❌ |
| **Prescription Generation** | ✅ | ✅ | ❌ | ❌ (Download only) |
| **View Appointments** | ✅ All doctors | 🔒 Own doctorId only | ✅ All doctors | 🔒 Own patientId only |
| **Manage Schedules** | ✅ All doctors | 🔒 Own schedule only | ❌ | ❌ |
| **Assign Clinic Roles** | ✅ (`/settings`) | ❌ | ❌ | ❌ |

---

## 8. REST API Reference

### Health & Core
- `GET /api/health` — Public server heartbeat (`{ status: 'ok', service: 'Node.js Integration API' }`).

### Doctors & Specializations
- `GET /api/doctors?specialization={spec}&onDutyOnly={bool}` — List active doctors.
- `GET /api/specializations` — List all clinic medical specialties.
- `GET /api/doctors/:id/schedule` — Doctor shift hours, lunch break, slot duration.
- `POST /api/doctors/:id/schedule` — Update schedule (`ADMIN` or self `DOCTOR`).

### Patients & Intake
- `GET /api/patients?search={query}` — Search patients by name or phone.
- `GET /api/patients/:id` — Retrieve full patient record and visit history.
- `POST /api/patients` — Composite intake (`visitType: 'WALK_IN' | 'APPOINTMENT' | 'NONE'`). Creates patient, optional appointment, and walk-in queue token.

### Appointments
- `GET /api/appointments?doctorId={id}&date={date}&status={status}` — Query appointments (Doctor is scoped to own `doctorId`).
- `GET /api/appointments/available-slots?doctorId={id}&date={YYYY-MM-DD}` — Invokes C++ engine to compute free slots.
- `POST /api/appointments` — Atomic slot reservation with conflict detection (`409 Conflict` on overlap).
- `GET /api/appointments/:id` — Appointment details.
- `POST /api/appointments/:id/checkin` — Arriving patient check-in; generates queue token.
- `PATCH /api/appointments/:id/complete` — Mark appointment finished.
- `PATCH /api/appointments/:id/cancel` — Cancel appointment.

### Queue
- `GET /api/queue?status=WAITING` — Returns waiting list sorted by C++ engine (`Emergency -> Senior -> Normal FIFO`).
- `POST /api/queue` — Intake walk-in token with mandatory `doctorId`.
- `POST /api/queue/:id/call` — Call next patient (enforces top of priority queue).
- `PATCH /api/queue/:id/cancel` — Cancel queue token.
- `GET /api/queue/my-token` — Real-time position tracking for patients.

### Consultations & Prescriptions
- `POST /api/consultations` — Save encounter diagnosis and notes.
- `POST /api/prescriptions` — Save medications, compile PDFKit document, trigger Telegram delivery.
- `GET /api/prescriptions/:id/download` — Download prescription PDF file.

---

## 9. Environment Variables & Ports

### `integration/.env`
```env
PORT=3000
FIREBASE_PROJECT_ID=oops-3d60f
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json
AI_SERVICE_URL=http://127.0.0.1:8001
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=default-admin-chat-id
TELEGRAM_WEBHOOK_SECRET=ClinicQueueSecretWebhookToken2026
PRESCRIPTION_DIR=./storage/prescriptions
CPP_ENGINE_PATH=../cpp-core/build/Debug/clinicqueue-engine.exe
CPP_ENGINE_TIMEOUT_MS=5000
NODE_TLS_REJECT_UNAUTHORIZED=0
```

### `ai-service/.env`
```env
GROQ_API_KEY=your-groq-api-key
```

### Standard Running Ports
- **Frontend App**: `http://localhost:5173`
- **Integration API**: `http://localhost:3000`
- **Clinical AI Service**: `http://127.0.0.1:8001`

### Demo Test Credentials
- **Admin**: `admin@gmail.com` / `Admin@123`
- **Doctor**: `doctor@gmail.com` / `Doctor@123`
- **Receptionist**: `receptionist@gmail.com` / `Receptionist@123`
- **Patient**: `patient.test@clinicqueue.internal` / `Patient@12345`

---

## 10. Critical Rules for Any AI Agent (Do's and Don'ts)

> [!IMPORTANT]
> **Preserve Real Implementations**: Never replace real APIs or database queries with mock static objects. All data flows to and from Firestore and the native C++ engine.
>
> **Do Not Introduce Docker**: Docker is intentionally excluded from this project. Everything runs natively on Windows/PowerShell via `start-all.ps1`.
>
> **Firestore Indexing Safeguard**: Firestore rejects compound inequality/equality queries that lack pre-built composite indexes. When querying Firestore, use single-field queries and perform secondary date or status filtering in-memory in Node.js.
>
> **Stable Patient Identity**: Never identify patients solely by phone number. Phone numbers are shared by families. Always resolve identity using stable `patientId`.
>
> **Preserve Multi-Doctor Flexibility**: Never write code that permanently binds a patient document to a single `doctorId`. Patients consult different specialists over time.
>
> **Maintain C++ Engine Protocol**: The C++ engine is the single source of truth for queue priority sorting and appointment slot calculations. Always interact with it through `CppEngine.execute(operation, payload)`.
>
> **Telegram RAG Integrity**: Do not hardcode FAQ answers. All clinical and hospital inquiries must route through the Python RAG microservice.
