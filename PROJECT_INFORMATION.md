# PROJECT_INFORMATION.md

> **Notice:** This document is the single, comprehensive, ground-truth technical knowledge base for the **ClinicQueue** healthcare management platform. It covers architecture, source code files, configurations, database schemas, IPC protocols, REST endpoints, operational workflows, and security models.

---

## 1. Project Overview

- **Project Name:** ClinicQueue (Healthcare OS)
- **One-Line Description:** An enterprise-grade, multi-tier outpatient clinic management system featuring automated patient intake, C++17 priority-triage scheduling, doctor consultation recording, PDF prescription delivery via Telegram, and a clinical AI FAQ microservice.
- **Detailed Purpose and Problem It Solves:**
  Traditional outpatient clinics struggle with chaotic front-desk walk-in queues, scheduling conflicts between pre-booked appointments and walk-ins, inefficient paper prescriptions, and disconnected patient communication. ClinicQueue unifies the entire outpatient lifecycle into a single operational system:
  1. *Deterministic Priority Triage:* Automatically enforces triage hierarchy (`Emergency -> Senior Citizen (60+) -> Normal FIFO`), preventing manual queue-jumping and prioritizing urgent cases.
  2. *Conflict-Free Appointment Scheduling:* Employs a pure C++17 domain engine to calculate available consultation slots dynamically using half-open time intervals `[start, end)`, doctor shift hours, lunch breaks, and holiday schedules.
  3. *Digital Prescriptions & Automated Delivery:* Doctors build structured e-prescriptions; the system compiles vector PDF documents and transmits them directly to patient Telegram accounts without paper handling.
  4. *Multi-Member Family Identity Management:* Allows a single Telegram account (`@Clinical_oops_bot`) to register and manage multiple family members (e.g., self, child, parent) sharing the same phone number while preserving independent medical records.
  5. *Clinical AI Knowledge Base:* Integrates BM25 lexical search with Groq neural LLM inference to answer clinic questions from verified medical guidelines and clinic policies.
- **Current Version:** `1.0.0`
- **License:** Proprietary / ClinicQueue Internal (No open-source license file committed in repository).
- **Repository URL / Links:** UNKNOWN — not found in codebase (managed as an on-premise local repository).
- **Project Status:** Active, Production-Ready MVP / Operational Enterprise Healthcare OS.

---

## 2. Tech Stack

### Languages & Versions
| Language | Version / Standard | Scope |
| :--- | :--- | :--- |
| **TypeScript** | `v5.4.5` (backend), `v5.9.2` (frontend) | Frontend UI, Node.js integration API, Telegram bot |
| **C++** | `C++17` (`ISO/IEC 14882:2017`) | Core domain engine (`cpp-core/`), queue & slot algorithms |
| **Python** | `3.11+` | Clinical AI microservice, document ingestion, BM25 & Groq RAG |
| **JavaScript / Node.js** | Node.js `20.x` LTS runtime | Express.js API, PDFKit compilation, Telegram bot daemon |
| **HTML5 / CSS3** | Modern CSS Variables & Flexbox/Grid | Figma-derived custom SaaS design system |

### Frameworks & Libraries
- **Frontend (`frontend/package.json`):**
  - `react`: `^19.1.1`
  - `react-dom`: `^19.1.1`
  - `react-router-dom`: `^7.9.2`
  - `@firebase/app`: `0.16.2`
  - `@firebase/auth`: `1.13.6`
  - `vite`: `^7.1.7`
  - `@vitejs/plugin-react`: `^5.0.4`
- **Integration API (`integration/package.json`):**
  - `express`: `^4.19.2`
  - `express-async-errors`: `^3.1.1`
  - `firebase-admin`: `^12.1.0`
  - `node-telegram-bot-api`: `^0.66.0`
  - `pdfkit`: `^0.15.0`
  - `axios`: `^1.6.8`
  - `cors`: `^2.8.5`
  - `dotenv`: `^16.4.5`
  - `multer`: `^1.4.5-lts.1`
  - `form-data`: `^4.0.0`
  - `ts-node-dev`: `^2.0.0`
- **AI Service (`ai-service/requirements.txt`):**
  - `fastapi`: `0.117.1`
  - `uvicorn[standard]`: `0.37.0`
  - `python-multipart`: `0.0.20`
  - `pypdf`: `6.1.1`
  - `requests`: Standard library / installed via environment
- **C++ Core Engine (`cpp-core/CMakeLists.txt`):**
  - `nlohmann_json`: `v3.11.3` (Fetched via CMake `FetchContent`)

### Databases & Storage
- **Primary Database:** Google Cloud Firestore (NoSQL Document Store, project `oops-3d60f`).
- **User Authentication:** Firebase Authentication (Email/Password provider).
- **File Storage:** Local filesystem storage for vector PDF prescriptions (`integration/storage/prescriptions/`).
- **Document Knowledge Store:** Local JSON document store (`ai-service/data/documents.json`) and Markdown knowledge assets (`data/clinic_knowledge/`).

### Infrastructure & Hosting
- **Architecture Style:** Decoupled Microservices / Multi-Process Local Service Mesh.
- **Process Orchestration:** PowerShell runner (`start-all.ps1`) launching independent daemon processes.
- **Port Allocation:**
  - Frontend Web UI: `http://localhost:5173`
  - Integration API & Telegram Bot: `http://localhost:3000`
  - Python AI Service: `http://127.0.0.1:8001`
  - C++ Engine: Spawned on-demand via standard I/O (`stdin`/`stdout`).

### Third-Party Services & APIs
1. **Google Firebase:** Firebase Authentication & Cloud Firestore database.
2. **Telegram Bot API:** `@Clinical_oops_bot` for multi-member patient registration, appointment status notifications, and PDF delivery.
3. **Groq Cloud API:** High-speed inference using `llama-3.1-8b-instant` for natural language triage and RAG synthesis.

### Package Managers & Build Configs
- `npm` (v10+): Managed via `frontend/package.json` and `integration/package.json`.
- `pip`: Managed via `ai-service/requirements.txt`.
- `cmake` (v3.21+): Managed via `cpp-core/CMakeLists.txt` using MSVC or GCC/Clang.

---

## 3. Architecture

### High-Level Architecture Diagram

```
                                  ┌──────────────────────────────────────────────┐
                                  │            React 19 + Vite Web Client        │
                                  │           (Enterprise Healthcare OS)         │
                                  │               Port: 5173                     │
                                  └──────────────────────┬───────────────────────┘
                                                         │ HTTP /api requests with
                                                         │ Firebase ID Token (Bearer)
                                                         ▼
┌───────────────────────────┐     ┌──────────────────────────────────────────────┐     ┌────────────────────────────┐
│      Telegram Bot API     │◄───►│            Node.js Integration API           │◄───►│     FastAPI AI Service     │
│   (@Clinical_oops_bot)    │     │  (Express + TypeScript + Firebase Admin SDK) │     │      (Python 3.11+)        │
│    Long-polling Daemon    │     │               Port: 3000                     │     │        Port: 8001          │
└───────────────────────────┘     └───────────────┬──────────────┬───────────────┘     └──────────────┬─────────────┘
                                                  │              │                                    │
                             Child Process (stdio)│              │ Firebase Admin SDK                 │ BM25 / Groq
                                                  ▼              ▼                                    ▼
                                  ┌───────────────────┐  ┌───────────────┐             ┌────────────────────────────┐
                                  │   C++17 Engine    │  │  Google Cloud │             │   Clinic Knowledge Store   │
                                  │ (Native Bin IPC)  │  │   Firestore   │             │   (hospital_info.md & docs)│
                                  └───────────────────┘  └───────────────┘             └────────────────────────────┘
```

### Folder and File Structure

```
ClinicQueue-Final-Formatted/
├── .gitignore                             # Git ignore rules for node_modules, build artifacts, etc.
├── AI_KNOWLEDGE_BASE.md                   # AI reference context
├── CLINICQUEUE_PROJECT_CONTEXT.md         # Master ground-truth architectural rules
├── PROJECT_INFORMATION.md                 # Complete project documentation knowledge base (this file)
├── README.md                              # High-level overview and run instructions
├── start-all.ps1                          # PowerShell orchestration script to run all 3 services
│
├── frontend/                              # Frontend React 19 Application
│   ├── .env                               # Local client environment config
│   ├── .env.example                       # Template for Firebase web credentials
│   ├── package.json                       # Dependencies & scripts for web client
│   ├── tsconfig.json                      # TypeScript configuration
│   ├── vite.config.ts                     # Vite build & proxy config (/api -> :3000)
│   └── src/
│       ├── main.tsx                       # React DOM entry point
│       ├── App.tsx                        # React Router layout and route declarations
│       ├── styles.css                     # Complete SaaS styling system (Navy/Teal design language)
│       ├── types.ts                       # Domain TypeScript interfaces (Doctor, Patient, Token, etc.)
│       ├── components/
│       │   ├── Layout.tsx                 # App Shell: collapsible sidebar, breadcrumbs, modals
│       │   ├── Ui.tsx                     # Reusable UI primitives: StatCard, Card, Badge, Button, Modal
│       │   └── Icon.tsx                   # Lucide-style SVG icon library (24+ custom icons)
│       ├── context/
│       │   └── AuthContext.tsx            # Firebase Auth provider, token refresh, and role cache
│       ├── pages/
│       │   ├── Dashboard.tsx              # Healthcare OS Dashboard (Admin, Doctor, Receptionist views)
│       │   ├── Patients.tsx               # Composite intake wizard (Walk-in, Appointment, Profile Only)
│       │   ├── Appointments.tsx           # Appointment management table, details drawer, 6-step wizard
│       │   ├── Queue.tsx                  # Live priority queue table, #1 Next caller badge
│       │   ├── Consultation.tsx           # Doctor consultation workspace, Rx item builder, Telegram sender
│       │   ├── PatientDashboard.tsx       # Patient self-service portal, family member switcher
│       │   ├── Login.tsx                  # Sign-in page with quick role autofill buttons
│       │   └── Settings.tsx               # Admin user management & Clinic FAQ RAG ingestion
│       └── services/
│           ├── api.ts                     # Axios client with Firebase Bearer token interceptor
│           └── firebase.ts                # Firebase client SDK initialization
│
├── integration/                           # Backend Integration Layer & Telegram Service
│   ├── .env                               # Server environment variables & service account path
│   ├── package.json                       # Dependencies & scripts for Node.js API
│   ├── tsconfig.json                      # Backend TypeScript compiler settings
│   ├── storage/
│   │   └── prescriptions/                 # Local directory where generated prescription PDFs are saved
│   └── src/
│       ├── app.ts                         # Express server bootstrap, middleware, public health checks
│       ├── cpp-adapter/
│       │   └── CppEngine.ts               # Child-process stdio bridge to clinicqueue-engine.exe
│       ├── firebase/
│       │   └── admin.ts                   # Firebase Admin SDK init & Firestore handle
│       ├── middleware/
│       │   └── auth.ts                    # authenticate & authorize(['ADMIN', ...]) middleware
│       ├── routes/
│       │   ├── appointments.ts            # CRUD, C++ slot generator, atomic booking, check-in
│       │   ├── auth.ts                    # User profile, role assignment, doctor duty toggle
│       │   ├── consultations.ts           # Consultation records creation & history retrieval
│       │   ├── dashboard.ts               # Stats, doctor-wise metrics, doctor-summary
│       │   ├── doctors.ts                 # Doctor listings, schedule rules, holiday management
│       │   ├── faq.ts                     # Admin FAQ document ingestion & RAG query proxy
│       │   ├── patientPortal.ts           # Patient portal endpoints, 6-digit link code generator
│       │   ├── patients.ts                # Composite patient intake, profile updates
│       │   ├── prescriptions.ts           # Prescription creation, PDFKit compiler, Telegram sender
│       │   ├── queue.ts                   # Priority queue endpoints, calling Next token, cancel
│       │   └── telegram.ts                # Telegram webhook endpoint (alternative to polling)
│       ├── scripts/
│       │   ├── check_doctors.ts           # Doctor data inspector script
│       │   ├── inspect_records.ts         # Firestore record integrity inspector
│       │   ├── reconcile_doctor_profile.ts# Doctor profile reconciliation helper
│       │   ├── seed_doctors.ts            # Default doctor directory & schedule seeder
│       │   ├── verify_all_requirements.ts # Comprehensive master test suite (47 verification tests)
│       │   ├── verify_appointment_system.ts # Appointment slot verification
│       │   ├── verify_critical_fixes.ts   # Regression checks
│       │   ├── verify_doctor_sync_pipeline.ts # Doctor directory auto-sync and AI RAG pipeline verification
│       │   ├── verify_family_telegram.ts  # Telegram multi-member verification
│       │   ├── verify_modernized_telegram.ts # Conversational AI Telegram bot verification suite
│       │   ├── verify_receptionist_doctor_registration.ts # Intake tests
│       │   ├── verify_telegram_faq.ts     # FAQ RAG response tests
│       │   └── verify_web_patient_prescription.ts # Web patient delivery test
│       ├── services/
│       │   ├── DoctorSyncService.ts       # Real-time sync of Firestore doctors to Markdown knowledge base & AI RAG
│       │   └── email.ts                   # Nodemailer SMTP email service for prescription PDF delivery
│       └── telegram/
│           ├── bot.ts                     # Telegram bot instance, router, polling setup
│           ├── ui.ts                      # Custom Telegram reply keyboards
│           ├── commands/
│           │   ├── start.ts               # /start command handler, family summary
│           │   └── faq.ts                 # FAQ inquiry handler using RAG
│           ├── services/
│           │   ├── FamilyService.ts       # Multi-member account manager, patient linking
│           │   ├── IntentRouter.ts        # Conversational dual-engine intent classification and routing
│           │   └── SessionService.ts      # Multi-step conversational state machine
│           └── workflows/
│               ├── BookingWorkflow.ts     # Step-by-step appointment booking via Telegram
│               ├── QueueWorkflow.ts       # Live queue token status, request, and cancel
│               └── RegistrationWorkflow.ts# Step-by-step patient registration wizard
│
├── cpp-core/                              # Core Domain Engine (Pure C++17)
│   ├── CMakeLists.txt                     # CMake build configuration with nlohmann_json
│   ├── include/
│   │   ├── Appointment.h                  # Appointment entity class
│   │   ├── AppointmentService.h           # Slot calculation & interval algorithm
│   │   ├── Clinic.h                       # Aggregated clinic domain model
│   │   ├── Doctor.h                       # Doctor entity class (inherits Person)
│   │   ├── DoctorSchedule.h               # Weekly schedule & shift hours struct
│   │   ├── Enums.h                        # Role, Priority, TokenStatus, AppointmentStatus enums
│   │   ├── Patient.h                      # Patient entity class (inherits Person)
│   │   ├── Person.h                       # Abstract Person base class
│   │   ├── Prescription.h                 # Prescription domain model
│   │   ├── QueueManager.h                 # Priority comparator & sorting logic
│   │   ├── QueueToken.h                   # Queue token model
│   │   └── ValidationService.h            # Conflict validation logic
│   ├── src/
│   │   ├── main.cpp                       # CLI entry point: reads JSON stdin, writes JSON stdout
│   │   ├── AppointmentService.cpp         # Slot generation implementation
│   │   ├── QueueManager.cpp               # Priority sorting implementation
│   │   └── ValidationService.cpp          # Appointment conflict validator implementation
│   ├── tests/
│   │   ├── test_appointments.cpp          # Slot algorithm unit tests
│   │   └── test_queue.cpp                 # Queue priority unit tests
│   └── build/Debug/
│       └── clinicqueue-engine.exe         # Compiled Windows executable
│
├── ai-service/                            # Clinical AI & RAG Microservice (Python FastAPI)
│   ├── .env                               # Groq API key configuration
│   ├── README.md                          # AI service documentation
│   ├── requirements.txt                   # Python dependencies (FastAPI, Uvicorn, pypdf)
│   ├── app/
│   │   ├── main.py                        # FastAPI application entry point
│   │   ├── api/
│   │   │   ├── health.py                  # Health check & document count endpoint
│   │   │   ├── nlp.py                     # Symptom-to-specialization mapping (Groq LLM)
│   │   │   ├── prescription.py            # Prescription clinical assistance endpoint
│   │   │   └── rag.py                     # Document ingestion and BM25 RAG query
│   │   ├── models/
│   │   │   └── schemas.py                 # Pydantic request/response schemas
│   │   └── services/
│   │       ├── document_service.py        # Text extraction (.txt, .md, .pdf) & persistence
│   │       └── rag_service.py             # BM25 token ranker + Groq LLM synthesis
│   ├── data/
│   │   ├── documents.json                 # Ingested documents and chunk index
│   │   └── clinic_knowledge/              # Knowledge files indexed for RAG
│   └── tests/
│       └── test_rag.py                    # BM25 & ingestion unit tests
│
├── data/                                  # Static Knowledge Assets
│   └── clinic_knowledge/
│       ├── doctors_directory.md           # Doctor directory, specializations, cabin rooms
│       └── hospital_information.md        # Hospital policies, working hours, triage rules
│
└── firebase/
    └── firestore.rules                    # Security rules locking down direct browser access
```

### Design Patterns Used
1. **Layered Architecture:** Strict separation between Presentation (React), Integration Gateway (Node.js), Core Business Logic (C++), and AI Service (Python).
2. **Adapter Pattern:** `CppEngine.ts` adapts native process execution (`spawn`) into a Promise-based asynchronous TypeScript interface.
3. **State Machine Pattern:** `SessionService.ts` maintains conversation state (`state`, `stepData`) for Telegram users navigating registration, booking, and FAQ workflows.
4. **Repository Pattern:** `FamilyService.ts` encapsulates Firestore operations for multi-member accounts, patient lookups, and link codes.
5. **Polymorphism & Inheritance (OOP):** `Person` abstract base class with derived `Doctor` and `Patient` classes in `cpp-core/include/`.
6. **Token-Based RBAC:** Role extraction and route authorization middleware (`authenticate`, `authorize`).
7. **Observer / Polling Pattern:** Long-polling daemon in `integration/src/telegram/bot.ts` for real-time Telegram message updates.

### End-to-End Data Flow

#### 1. Appointment Booking Flow
1. Patient or staff selects Doctor, Date, and Specialization on React frontend or Telegram.
2. Request hits `GET /api/appointments/available-slots`.
3. Node.js retrieves the doctor's weekly schedule, existing bookings, and holidays from Firestore.
4. Node.js invokes `clinicqueue-engine.exe` via stdin:
   ```json
   {
     "operation": "generateSlots",
     "payload": {
       "startTime": "09:00",
       "endTime": "17:00",
       "lunchStart": "13:00",
       "lunchEnd": "14:00",
       "slotDurationMinutes": 20,
       "bookedSlots": ["10:00", "11:20"],
       "targetDate": "2026-10-25"
     }
   }
   ```
5. C++ engine computes available half-open intervals and outputs JSON via stdout.
6. User selects a slot and submits `POST /api/appointments`.
7. Node.js performs an atomic conflict check in Firestore and reserves the slot.

#### 2. Patient Intake & Queue Flow
1. Receptionist submits patient info via `/patients` wizard.
2. If patient age is >= 60, priority automatically upgrades to `SENIOR` (unless marked `EMERGENCY`).
3. If walk-in visit, a queue ticket (`T-X`) is generated and added to `queue` collection.
4. When `GET /api/queue?status=WAITING` is requested, Node.js passes all waiting tokens to C++ `orderQueue`.
5. C++ sorts strictly: `EMERGENCY (0) -> SENIOR (1) -> NORMAL (2)`, ascending FIFO by `createdAt`.
6. Doctor clicks **Call Next**: backend verifies the called token is at position #1. Out-of-order calls are rejected with `409 Conflict`.

#### 3. Prescription Generation & Telegram Delivery
1. Doctor finishes consultation on `/consultations/:id` and enters prescription items.
2. Request hits `POST /api/prescriptions`.
3. Node.js persists prescription metadata in Firestore.
4. `pdfkit` compiles an official medical prescription vector PDF saved to `integration/storage/prescriptions/prescription_{id}.pdf`.
5. Backend checks if patient is linked to Telegram (`telegramChatId` or phone match).
6. If linked, the bot transmits the PDF file directly to the patient's chat with dosage guidance. If not linked, a 6-digit Telegram linking code is provided.

---

## 4. How It Works (Detailed)

### Core Features & Logic Implementation

#### A. Walk-in Intake & Doctor Specialization Routing
- **Files:** [Patients.tsx](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/frontend/src/pages/Patients.tsx), [patients.ts](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/integration/src/routes/patients.ts)
- **Logic:**
  1. Intake accepts three visit types: `WALK_IN`, `APPOINTMENT`, and `NONE` (profile registration only).
  2. For clinical visits, selecting a medical specialization (e.g. `Cardiologist`) dynamically queries `/api/doctors?specialization=Cardiologist&onDutyOnly=true`.
  3. Only active, on-duty physicians are presented to avoid routing patients to unavailable doctors.
  4. Automatic senior citizen triage: if `age >= 60` and priority is `NORMAL`, the system automatically assigns priority `SENIOR`.

#### B. Deterministic Priority Queue Ordering
- **Files:** [QueueEngine.cpp](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/cpp-core/src/QueueManager.cpp), [QueueManager.h](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/cpp-core/include/QueueManager.h), [queue.ts](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/integration/src/routes/queue.ts)
- **Algorithm:**
  - Strict priority ranking:
    - `EMERGENCY` = Rank 0
    - `SENIOR` = Rank 1
    - `NORMAL` = Rank 2
  - C++ `std::stable_sort` comparator:
    ```cpp
    int leftRank = priorityRank(left.priority());
    int rightRank = priorityRank(right.priority());
    if (leftRank != rightRank) return leftRank < rightRank;
    return left.createdAt() < right.createdAt();
    ```
  - Prevents queue jumping: A physician calling a patient must call the top token (`ordered[0]`). If an attempt is made to call a token out of order, the API rejects it with `409 Conflict`.

#### C. Conflict-Free Appointment Slot Engine
- **Files:** [AppointmentService.cpp](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/cpp-core/src/AppointmentService.cpp), [appointments.ts](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/integration/src/routes/appointments.ts)
- **Algorithm:**
  - Evaluates half-open intervals `[slotStart, slotEnd)`.
  - Increments by `slotDurationMinutes` (default 20 mins) from `startTime` to `endTime`.
  - Excludes:
    - Any slot overlapping lunch interval `[lunchStart, lunchEnd)`.
    - Any slot whose date is not in `workingDays` array (`0=Sun` to `6=Sat`).
    - Any slot present in `bookedSlots` (unless appointment status is `CANCELLED`).
    - Past time slots if the target date is today.
    - Slots exceeding `maxAppointments` capacity limit.

#### D. Multi-Member Telegram Bot & Conversational AI Assistant (`@Clinical_oops_bot`)
- **Files:** [bot.ts](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/integration/src/telegram/bot.ts), [IntentRouter.ts](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/integration/src/telegram/services/IntentRouter.ts), [FamilyService.ts](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/integration/src/telegram/services/FamilyService.ts), [SessionService.ts](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/integration/src/telegram/services/SessionService.ts), [BookingWorkflow.ts](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/integration/src/telegram/workflows/BookingWorkflow.ts)
- **Logic:**
  - **Conversational Natural Language Routing (`IntentRouter.ts`):** Free-form messages are evaluated through a dual-engine classifier (`POST /nlp/classify` on FastAPI AI microservice with Groq LLM `openai/gpt-oss-20b`, and a deterministic regex fallback engine). Categorizes intents into: `emergency`, `hospital_timings`, `consultation_fees`, `hospital_info`, `doctor_info`, `symptom_description`, `appointment_request`, `appointment_status`, `appointment_cancellation`, `patient_registration`, `greeting`, `thanks`, `goodbye`, and `clarification_required`.
  - **Emergency Safeguard:** Immediately detects acute symptoms (chest pain, stroke, breathlessness, hemorrhaging) and responds with critical medical guidance and the 24/7 clinic emergency hotline (`+1 (555) 019-3637`).
  - **Dynamic Specializations & Doctor Rosters:** Replaced hardcoded specialties with `getAvailableSpecializations()`, querying Firestore `users` for active physicians in real time.
  - **Multi-Member Identity:** Stored in `family_accounts/{chatId}`. A single Telegram account can link multiple family members (`Self`, `Spouse`, `Child`, `Parent`, etc.), preserving independent patient medical records sharing a phone number.
  - **State Machine Integrity:** Active session states (`FAM_REG_*`, `BOOKING_*`, `FAM_SELECT_ACTIVE`, `FAM_LINK_CODE`, `FAQ_QUESTION`) in `telegramSessions/{chatId}` take strict precedence over NLP parsing to ensure multi-step interactive workflows are never bypassed.

#### E. Clinical AI RAG & Doctor Auto-Sync Pipeline
- **Files:** [DoctorSyncService.ts](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/integration/src/services/DoctorSyncService.ts), [rag_service.py](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/ai-service/app/services/rag_service.py), [document_service.py](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/ai-service/app/services/document_service.py), [nlp.py](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/ai-service/app/api/nlp.py)
- **Logic:**
  - **Real-Time Doctor Knowledge Sync (`DoctorSyncService.ts`):** Whenever an admin adds or updates a doctor (`POST /api/admin/users`, `PATCH /api/doctors/:id`, or `POST /api/doctors/:id/schedule`), the system dynamically queries Firestore `users` and `doctor_schedules`, compiles an authoritative Markdown directory into `data/clinic_knowledge/doctors_directory.md`, and transmits it to `POST /rag/ingest`.
  - **AI RAG Indexing:** Ingested Markdown files are tokenized, segmented into overlapping chunks, and persisted in `ai-service/data/documents.json`. BM25 ranker searches passages and feeds context to Groq LLM inference (`openai/gpt-oss-20b`), answering patient inquiries about physician timings, cabin rooms, fees, and clinic policies.
  - **Dual-Engine Specialization NLP (`/nlp/specialization` & `/nlp/classify`):** Accurately distinguishes non-medical inquiries from clinical symptom descriptions, mapping patient symptoms to appropriate departments (Cardiology, Dermatology, Orthopedics, Neurology, Pediatrics, ENT, Dental, General Medicine).

#### F. Digital Prescription Compilation & Dual Telegram/Email Delivery
- **Files:** [prescriptions.ts](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/integration/src/routes/prescriptions.ts), [email.ts](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/integration/src/services/email.ts)
- **Logic:**
  - **PDF Generation:** Assembles official prescription documents via PDFKit complete with clinic branding, patient demographics, clinical vitals (BP, Heart Rate, SpO2, Temperature), ICD-10 diagnoses, medicine tables, and doctor's digital license signature.
  - **Telegram Delivery:** Automatically pushes compiled PDF documents directly to linked patient Telegram chat sessions.
  - **Email Fallback Delivery (`email.ts`):** For walk-in patients registered by receptionists who lack a linked Telegram account, doctors can enter an email address. The system dispatches an official clinical email via Nodemailer SMTP with the PDF prescription attached and logs delivery telemetry in `emailDeliveryLogs`. Endpoint: `POST /api/prescriptions/:id/send-email`.

#### G. Admin Healthcare OS Dashboard
- **Files:** [Dashboard.tsx](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/frontend/src/pages/Dashboard.tsx), [Layout.tsx](file:///c:/Users/zades/Downloads/ClinicQueue-Final-Formatted/frontend/src/components/Layout.tsx)
- **Logic:**
  - Real-time pulse stats: Waiting Patients, Completed Visits Today, Emergency Cases, Doctors On Duty.
  - Live Queue Overview with direct re-assignment shortcuts.
  - Today's Appointments with inline patient check-in.
  - Live Microservices Health Widget (Telegram Bot status, FastAPI status).
  - Modal shortcuts for user creation, Financials overview, and Operational Analytics.
  - Doctor-Wise Patient Management: Inspect individual physician workloads, unique patients vs. total visits, and consultation histories.

---

## 5. Setup & Installation

### Prerequisites
- **Operating System:** Windows 10/11, macOS, or Linux.
- **Node.js:** `v20.x` or later.
- **Python:** `3.11+` (with `venv`).
- **C++ Compiler:** MSVC (Visual Studio 2022 / C++ Build Tools) or GCC/Clang with C++17 support.
- **CMake:** `v3.21` or later.
- **Firebase Account:** Google Firebase project with Authentication (Email/Password) and Cloud Firestore enabled.

### Step-by-Step Local Setup

#### Step 1: Clone and Enter Repository
```powershell
cd c:\Users\zades\Downloads\ClinicQueue-Final-Formatted
```

#### Step 2: C++ Core Engine Build
```powershell
cd cpp-core
mkdir build -ErrorAction SilentlyContinue
cd build
cmake .. -DCMAKE_BUILD_TYPE=Debug
cmake --build . --config Debug
cd ../..
```
*Binary generated at:* `cpp-core/build/Debug/clinicqueue-engine.exe`.

#### Step 3: Python AI Service Setup
```powershell
cd ai-service
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..
```

#### Step 4: Backend Integration Setup
```powershell
cd integration
npm install
cd ..
```

#### Step 5: Frontend Web Client Setup
```powershell
cd frontend
npm install
cd ..
```

### Environment Variables

#### `integration/.env`
| Variable | Required | Purpose | Example Value |
| :--- | :---: | :--- | :--- |
| `PORT` | Yes | HTTP port for the Node.js API | `3000` |
| `FIREBASE_PROJECT_ID` | Yes | Google Cloud Firebase Project ID | `oops-3d60f` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Yes | Absolute path to Firebase Service Account JSON key | `C:\keys\service-account.json` |
| `AI_SERVICE_URL` | Yes | Base URL for the Python FastAPI AI service | `http://127.0.0.1:8001` |
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram Bot API token from `@BotFather` | `8623065216:AAHDs...` |
| `TELEGRAM_CHAT_ID` | Optional | Default fallback admin Telegram Chat ID | `7967702570` |
| `TELEGRAM_WEBHOOK_SECRET` | Optional | Webhook secret token for HTTPS verification | `ClinicQueueSecretWebhookToken2026` |
| `PRESCRIPTION_DIR` | Yes | Local directory for compiled prescription PDFs | `./storage/prescriptions` |
| `CPP_ENGINE_PATH` | Yes | Relative or absolute path to C++ binary | `../cpp-core/build/Debug/clinicqueue-engine.exe` |
| `CPP_ENGINE_TIMEOUT_MS` | Yes | Max execution timeout for C++ child process (ms) | `5000` |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Yes | Disable self-signed TLS errors during local dev | `0` |

#### `frontend/.env`
| Variable | Required | Purpose | Example Value |
| :--- | :---: | :--- | :--- |
| `VITE_FIREBASE_API_KEY` | Yes | Firebase Web Client API Key | `AIzaSyD0OvF8...` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Yes | Firebase Auth Domain | `oops-3d60f.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Yes | Firebase Project ID | `oops-3d60f` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Yes | Firebase Cloud Messaging Sender ID | `319842911128` |
| `VITE_FIREBASE_APP_ID` | Yes | Firebase Web App Application ID | `1:319842911128:web:2bc6...` |
| `VITE_API_BASE_URL` | Yes | API base prefix proxied by Vite | `/api` |

#### `ai-service/.env`
| Variable | Required | Purpose | Example Value |
| :--- | :---: | :--- | :--- |
| `GROQ_API_KEY` | Optional | Groq Cloud API Key for neural LLM synthesis | `gsk_px9R3214...` |

### How to Run the Application

#### Option A: Unified Launcher (Recommended)
From the project root in PowerShell:
```powershell
.\start-all.ps1
```

#### Option B: Manual Process Execution
1. **AI Service:**
   ```powershell
   cd ai-service
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001
   ```
2. **Integration API & Telegram Bot:**
   ```powershell
   cd integration
   $env:NODE_TLS_REJECT_UNAUTHORIZED='0'
   npm run dev
   ```
3. **Frontend Web UI:**
   ```powershell
   cd frontend
   npm run dev
   ```

### How to Run Tests & Linters
- **Master Comprehensive Verification Suite (All 14 Core Requirements):**
  ```powershell
  cd integration
  $env:NODE_TLS_REJECT_UNAUTHORIZED='0'
  npx ts-node-dev -r dotenv/config --transpile-only src/scripts/verify_all_requirements.ts
  ```
- **C++ Engine Unit Tests:**
  ```powershell
  cd cpp-core/build
  ctest --output-on-failure
  ```
- **Python AI Service Tests:**
  ```powershell
  cd ai-service
  python -m unittest discover -s tests -v
  ```
- **Frontend Strict TypeScript Compilation & Build:**
  ```powershell
  cd frontend
  npm run build
  ```

---

## 6. Configuration

### 1. `frontend/vite.config.ts`
Configures React plugin and dev proxy routing `/api` to the Node.js backend:
```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
});
```

### 2. `firebase/firestore.rules`
Strict zero-trust client security rule denying direct browser writes and queries:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### 3. `integration/tsconfig.json`
TypeScript target `ES2022`, module `commonjs`, output directory `dist/`.

---

## 7. API Reference

All routes except `/api/health`, `/api/health/system`, and `/api/telegram/webhook` require:
```http
Authorization: Bearer <Firebase_ID_Token>
```

### Health & Monitoring
- **`GET /api/health`**
  - *Auth:* Public
  - *Response:* `200 OK`
    ```json
    { "status": "ok", "service": "Node.js Integration API" }
    ```
- **`GET /api/health/system`**
  - *Auth:* Public
  - *Response:* `200 OK`
    ```json
    { "telegram": true, "rag": true, "engine": true, "node": true }
    ```

### Authentication & Users
- **`GET /api/me`**
  - *Auth:* Any authenticated user
  - *Response:* Profile record from `users` collection (`uid`, `name`, `email`, `role`, `onDuty`, `specialization`).
- **`POST /api/admin/users`**
  - *Auth:* `ADMIN`
  - *Body:*
    ```json
    {
      "name": "Dr. Sarah Jenkins",
      "email": "sarah@clinicqueue.health",
      "password": "Password@123",
      "role": "DOCTOR",
      "specialization": "Pediatrician",
      "room": "Cabin 204",
      "fee": "$45",
      "active": true
    }
    ```
  - *Action:* Creates Firebase Auth user via Admin SDK, writes Firestore user profile, initializes default doctor schedule, and automatically invokes `DoctorSyncService.syncDoctorsKnowledgeBase()` to update `doctors_directory.md` and re-index into AI Service RAG.
- **`POST /api/me/availability`**
  - *Auth:* `DOCTOR`
  - *Body:* `{ "onDuty": true }`
  - *Response:* Updates doctor availability status for patient intake.

### Doctors & Schedules
- **`GET /api/doctors?specialization={spec}&onDutyOnly={bool}`**
  - *Auth:* Any authenticated user
  - *Response:* Array of active physician profiles.
- **`GET /api/specializations`**
  - *Auth:* Public / Authenticated
  - *Response:* Array of unique medical specialties configured across active clinic doctors.
- **`GET /api/doctors/:id/schedule`**
  - *Auth:* Authenticated
  - *Response:* Weekly shift hours, lunch break, and slot duration.
- **`POST /api/doctors/:id/schedule`**
  - *Auth:* `ADMIN` or matching `DOCTOR`
  - *Body:* `{ "workingDays": [1,2,3,4,5], "startTime": "09:00", "endTime": "17:00", "lunchStart": "13:00", "lunchEnd": "14:00", "slotDurationMinutes": 20, "maxAppointments": 25 }`
  - *Action:* Updates schedule, optionally updates doctor specialization, and automatically triggers `DoctorSyncService.syncDoctorsKnowledgeBase()`.
- **`PATCH /api/doctors/:id`** & **`PUT /api/doctors/:id`**
  - *Auth:* `ADMIN` or matching `DOCTOR`
  - *Body:* `{ "name": "Dr. Sarah Jenkins", "specialization": "Pediatrician", "room": "Cabin 205", "fee": "$50", "active": true, "onDuty": true }`
  - *Action:* Updates doctor fields in Firestore and triggers `DoctorSyncService.syncDoctorsKnowledgeBase()`.
- **`GET /api/doctors/:id/holidays`** & **`POST /api/doctors/:id/holidays`**
  - *Auth:* `ADMIN` or matching `DOCTOR`
  - *Body:* `{ "date": "2026-11-25", "reason": "Medical Conference" }`

### Patients & Intake
- **`GET /api/patients?search={query}`**
  - *Auth:* Authenticated
  - *Response:* Patients matching name or phone substring.
- **`GET /api/patients/:id`**
  - *Auth:* Authenticated (`ADMIN`/`DOCTOR` see clinical history; `RECEPTIONIST` sees demographics only).
- **`POST /api/patients`**
  - *Auth:* `ADMIN`, `RECEPTIONIST`
  - *Body:*
    ```json
    {
      "name": "John Doe",
      "phone": "+919876543210",
      "age": 64,
      "gender": "Male",
      "notes": "Cardiac follow-up",
      "visitType": "WALK_IN",
      "doctorId": "DOC_123",
      "priority": "SENIOR"
    }
    ```
  - *Response:* `201 Created` with `patient`, optional `appointment`, and live `queueToken`.

### Appointments
- **`GET /api/appointments?doctorId={id}&date={YYYY-MM-DD}&status={status}`**
  - *Auth:* Authenticated (Doctors restricted to own `doctorId`).
- **`GET /api/appointments/available-slots?doctorId={id}&date={YYYY-MM-DD}`**
  - *Auth:* Authenticated
  - *Action:* Calls C++ engine `generateSlots`.
  - *Response:* `{ "doctorId": "...", "date": "...", "slots": ["09:00", "09:20", "09:40", ...] }`
- **`POST /api/appointments`**
  - *Auth:* Authenticated
  - *Body:* `{ "doctorId": "...", "patientId": "...", "date": "2026-10-25", "startTime": "10:20", "notes": "..." }`
  - *Response:* `201 Created` with atomic reservation. Returns `409 Conflict` if slot already taken.
- **`POST /api/appointments/:id/checkin`**
  - *Auth:* `ADMIN`, `DOCTOR`, `RECEPTIONIST`, `PATIENT`
  - *Action:* Atomically transitions status to `CHECKED_IN` and generates live queue token `T-X`.
- **`POST /api/appointments/:id/cancel`**
  - *Auth:* Authenticated
  - *Response:* Transitions status to `CANCELLED` and clears slot.

### Queue Management
- **`GET /api/queue?status=WAITING`**
  - *Auth:* Authenticated
  - *Action:* Loads waiting tokens and invokes C++ engine `orderQueue`.
  - *Response:* Deterministically sorted array by `Emergency -> Senior -> Normal FIFO`.
- **`POST /api/queue/:id/call`**
  - *Auth:* `DOCTOR`, `RECEPTIONIST`, `ADMIN`
  - *Action:* Marks token `CALLED`. Empowers doctors to call any checked-in waiting patient directly, immediately routing the physician to consultation and prescription generation.
- **`POST /api/queue/call-next`**
  - *Auth:* `DOCTOR`, `RECEPTIONIST`, `ADMIN`
  - *Action:* Automatically queries waiting patients for the calling doctor, executes C++ priority sorting (`Emergency -> Senior -> Normal`), and calls the next patient in line.
- **`PATCH /api/queue/:id/cancel`**
  - *Auth:* `ADMIN`, `RECEPTIONIST`
  - *Body:* `{ "reason": "Patient departed" }`
- **`GET /api/queue/my-token`**
  - *Auth:* Authenticated Patient
  - *Response:* Active token position, ahead count, and estimated wait minutes.

### Consultations & Prescriptions
- **`POST /api/consultations`**
  - *Auth:* `DOCTOR`
  - *Body:* `{ "queueId": "...", "patientId": "...", "diagnosis": "...", "notes": "..." }`
- **`POST /api/prescriptions`**
  - *Auth:* `DOCTOR`
  - *Body:*
    ```json
    {
      "consultationId": "...",
      "patientId": "...",
      "medications": [
        { "name": "Amoxicillin 500mg", "dosage": "1 cap", "frequency": "1-0-1", "duration": "5 days", "instructions": "After meals" }
      ],
      "instructions": "Drink plenty of fluids",
      "followUpDate": "2026-11-01"
    }
    ```
  - *Action:* Saves metadata, compiles PDF, and attempts Telegram transmission.
- **`GET /api/prescriptions/:id/pdf`**
  - *Auth:* Authenticated
  - *Response:* Binary streaming of PDF file (`Content-Type: application/pdf`).
- **`POST /api/prescriptions/:id/send-telegram`** & **`POST /api/prescriptions/:id/retry-telegram`**
  - *Auth:* `DOCTOR`, `ADMIN`
  - *Action:* Manually triggers/retries Telegram PDF transmission.
- **`POST /api/prescriptions/:id/send-email`**
  - *Auth:* `DOCTOR`, `ADMIN`, `RECEPTIONIST`
  - *Body:* `{ "email": "patient@example.com" }`
  - *Action:* Dispatches official prescription PDF via Nodemailer SMTP to patient's email address and logs delivery status in `emailDeliveryLogs`.

### Clinical AI & Knowledge Base
- **`GET /api/admin/rag/documents`** — List indexed documents (ADMIN).
- **`POST /api/admin/rag/ingest`** — Upload `.md`, `.txt`, `.pdf` knowledge source (ADMIN).
- **`POST /api/admin/rag/sync-knowledge`** — One-click sync of hospital info and live doctor profiles into RAG (ADMIN).
- **`POST /api/ai/rag/query`** — Query clinical RAG knowledge base.
- **`POST /nlp/specialization` (AI Service :8001)** — Map symptoms to clinical specialty.
- **`POST /nlp/classify` (AI Service :8001)** — Dual-engine multi-class intent classification (`emergency`, `greeting`, `hospital_timings`, `consultation_fees`, `hospital_info`, `doctor_info`, `symptom_description`, `appointment_request`, `appointment_status`, `appointment_cancellation`, `patient_registration`, `thanks`, `goodbye`, `clarification_required`).

---

## 8. Database & Data Models

### Firestore Collections Architecture

```
Firestore Root
├── users/                     # Staff & registered patient profiles
├── patients/                  # Canonical patient demographic records
├── appointments/              # Pre-booked specialist consultations
├── queue/                     # Live waiting-room queue tokens
├── consultations/             # Clinical consultation encounter logs
├── prescriptions/             # Medication orders & PDF delivery logs
├── doctor_schedules/          # Working days, shift hours, slot durations
├── doctor_holidays/           # Doctor leave days & clinic closures
├── family_accounts/           # Multi-member Telegram family links
├── telegramSessions/          # Conversational state machine for Telegram bot
└── telegramLinkCodes/         # 6-digit temporary linking verification codes
```

### Collection Schemas

#### 1. `users`
| Field | Type | Description |
| :--- | :--- | :--- |
| `uid` | `string` | Firebase Auth User UID |
| `name` | `string` | Staff / Patient display name |
| `email` | `string` | Login email address |
| `role` | `string` | `'ADMIN' \| 'DOCTOR' \| 'RECEPTIONIST' \| 'PATIENT'` |
| `active` | `boolean` | Account active flag |
| `onDuty` | `boolean` | Active duty status (Doctors only) |
| `specialization` | `string` | Medical specialty (e.g. `'Cardiologist'`) |
| `room` | `string` | Consultation cabin / room number |
| `fee` | `string` | Consultation fee (e.g. `'$50'`) |
| `patientId` | `string` | Associated patient record ID (Patients only) |

#### 2. `patients`
| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Canonical identifier (e.g. `PAT-1082`) |
| `name` | `string` | Full legal name |
| `phone` | `string` | Contact phone number (E.164 or national format) |
| `age` | `number` | Age in years (0 - 130) |
| `gender` | `string` | `'Male' \| 'Female' \| 'Other'` |
| `relationship`| `string` | Family relation (`'Self'`, `'Spouse'`, `'Child'`, etc.) |
| `notes` | `string` | Medical history notes |
| `telegramChatId` | `number` | Linked numeric Telegram Chat ID |
| `telegramLinked` | `boolean`| True if linked to Telegram |

#### 3. `appointments`
| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Appointment document ID |
| `doctorId` | `string` | Attending physician UID |
| `doctorName` | `string` | Attending physician display name |
| `doctorSpecialization`| `string` | Specialty |
| `patientId` | `string` | Patient canonical ID |
| `patientName` | `string` | Patient name |
| `patientPhone`| `string` | Patient phone number |
| `date` | `string` | Date string (`YYYY-MM-DD`) |
| `startTime` | `string` | 24-hr slot start (`HH:mm`) |
| `endTime` | `string` | 24-hr slot end (`HH:mm`) |
| `status` | `string` | `'BOOKED' \| 'CONFIRMED' \| 'CHECKED_IN' \| 'COMPLETED' \| 'CANCELLED'` |
| `checkInStatus`| `string` | `'NOT_ARRIVED' \| 'CHECKED_IN'` |
| `queueToken` | `string` | Assigned token number upon check-in (e.g. `'T-3'`) |

#### 4. `queue`
| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Queue token document ID |
| `tokenNumber` | `string` | Display token string (`T-1`, `T-2`, etc.) |
| `patientId` | `string` | Canonical patient ID |
| `patientName` | `string` | Patient name |
| `patientAge` | `number` | Patient age |
| `doctorId` | `string` | Target physician UID |
| `priority` | `string` | `'EMERGENCY' \| 'SENIOR' \| 'NORMAL'` |
| `status` | `string` | `'WAITING' \| 'CALLED' \| 'COMPLETED' \| 'CANCELLED'` |
| `source` | `string` | `'WALK_IN' \| 'APPOINTMENT'` |
| `position` | `number` | Real-time queue position rank |
| `createdAt` | `string` | ISO 8601 creation timestamp |

#### 5. `prescriptions`
| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Prescription ID |
| `consultationId` | `string` | Encounter ID |
| `patientId` | `string` | Patient ID |
| `doctorId` | `string` | Doctor UID |
| `medications` | `array` | Objects: `{ name, dosage, frequency, duration, instructions }` |
| `instructions`| `string` | General clinical advice |
| `pdfPath` | `string` | Local disk path to PDF (`./storage/prescriptions/...`) |
| `telegramDelivery` | `object` | Delivery audit log (`sent`, `chatId`, `sentAt`, `error`) |

---

## 9. Authentication & Security

### Authentication Mechanism
- **Client Identity:** Users authenticate using Firebase Authentication (Email/Password).
- **Token Passing:** Frontend transmits the Firebase ID Token in the `Authorization: Bearer <token>` HTTP header.
- **Token Verification:** Node.js integration API verifies token authenticity and expiration via `admin.auth().verifyIdToken(token)`.
- **RBAC Enforcement:** Middleware queries `users/{uid}` to determine user role and verifies permissions against route requirements:
  ```typescript
  export const authorize = (allowedRoles: string[]) => {
    return (req: any, res: any, next: any) => {
      if (!req.user || !allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
      }
      next();
    };
  };
  ```

### Role-Based Access Control (RBAC) Matrix
| Resource / Action | `ADMIN` | `DOCTOR` | `RECEPTIONIST` | `PATIENT` |
| :--- | :---: | :---: | :---: | :---: |
| Admin Dashboard & Metrics | Full | Self | Intake only | ❌ |
| Create Clinic Users (`/admin/users`) | ✅ | ❌ | ❌ | ❌ |
| Patient Intake (Walk-in & Appt) | ✅ | ❌ | ✅ | ❌ |
| View Appointments | All | Own Doctor | All | Own Patient |
| Call Queue Token (`/queue/:id/call`)| ❌ | ✅ (Own queue) | ✅ (Reception)| ❌ |
| Conduct Consultation & Prescribe | ❌ | ✅ | ❌ | ❌ |
| Download Prescription PDF | ✅ | ✅ | ✅ | ✅ (Own Rx) |
| Manage Doctor Schedules | ✅ | ✅ (Self) | ❌ | ❌ |
| Ingest Clinic FAQ Documents | ✅ | ❌ | ❌ | ❌ |

### Security Measures
1. **Firestore Client Lockdown:** Direct browser access to Firestore is completely denied via `firebase/firestore.rules`.
2. **Path Traversal Protection:** Prescription downloads validate that requested files reside strictly inside `storage/prescriptions/`.
3. **Telegram Link Codes:** Patients link external Telegram accounts by generating a cryptographic 6-digit one-time code valid for 15 minutes.
4. **Input Sanitization:** Uploaded FAQ files are restricted to `.md`, `.txt`, `.pdf` and capped at 10 MB.

---

## 10. Dependencies

### Integration API (`integration/package.json`)
| Dependency | Version | Purpose | Why Chosen |
| :--- | :--- | :--- | :--- |
| `express` | `^4.19.2` | HTTP REST API framework | Lightweight, modular routing |
| `firebase-admin`| `^12.1.0` | Google Firebase Admin SDK | Secure server-side Firestore & Auth operations |
| `node-telegram-bot-api` | `^0.66.0` | Telegram Bot API client | Robust polling, keyboards, and document uploads |
| `pdfkit` | `^0.15.0` | Vector PDF generation | High-fidelity e-prescription layouts without browser engines |
| `axios` | `^1.6.8` | HTTP client | Invoking FastAPI AI service & Groq endpoints |
| `cors` | `^2.8.5` | CORS middleware | Cross-origin request management |
| `dotenv` | `^16.4.5` | Environment loader | Configuration management |
| `multer` | `^1.4.5-lts.1` | Multipart parser | Processing uploaded FAQ documents |

### Frontend Client (`frontend/package.json`)
| Dependency | Version | Purpose | Why Chosen |
| :--- | :--- | :--- | :--- |
| `react` | `^19.1.1` | UI Library | Component-driven architecture |
| `react-dom` | `^19.1.1` | React DOM renderer | Web browser rendering |
| `react-router-dom` | `^7.9.2` | Client router | Fast client-side navigation |
| `@firebase/app` | `0.16.2` | Firebase Web App core | Client initialization |
| `@firebase/auth`| `1.13.6` | Firebase Auth client | Browser sign-in and token management |
| `vite` | `^7.1.7` | Bundler & dev server | Fast HMR & optimized production builds |

### AI Microservice (`ai-service/requirements.txt`)
| Dependency | Version | Purpose | Why Chosen |
| :--- | :--- | :--- | :--- |
| `fastapi` | `0.117.1` | Async Web framework | High performance, auto OpenAPI documentation |
| `uvicorn` | `0.37.0` | ASGI Server | Async HTTP request handling |
| `python-multipart` | `0.0.20` | Upload parser | Multipart document uploads |
| `pypdf` | `6.1.1` | PDF text extraction | Extracting text from uploaded hospital PDF policies |

---

## 11. Scripts & Commands

### Master Scripts
- `.\start-all.ps1`: Launches AI service (:8001), Integration API (:3000), and React Frontend (:5173) in separate PowerShell processes.

### Frontend Scripts (`frontend/package.json`)
- `npm run dev`: Starts Vite local development server on port 5173.
- `npm run build`: Runs TypeScript compiler (`tsc -b`) followed by Vite production bundling (`vite build`).
- `npm run preview`: Locally previews production build output in `dist/`.

### Integration API Scripts (`integration/package.json`)
- `npm run dev`: Launches development API with auto-reload using `ts-node-dev`.
- `npm run build`: Compiles TypeScript files to JavaScript in `dist/`.
- `npm start`: Runs compiled production server from `dist/app.js`.

### Diagnostic & Verification Scripts (`integration/src/scripts/`)
- `verify_all_requirements.ts`: Comprehensive test suite verifying all 14 core requirements across multi-doctor consults, queue ordering, Telegram linking, prescription generation, and AI RAG.
- `seed_doctors.ts`: Seeds initial doctors, specialties, and weekly consultation schedules in Firestore.
- `check_doctors.ts`: Validates doctor profiles and on-duty status.
- `inspect_records.ts`: Inspects Firestore document integrity.
- `reconcile_doctor_profile.ts`: Repairs doctor profiles linked to user accounts.

---

## 12. Testing

### Test Coverage Overview
- **Automated Master Test Suite:** 47 automated tests in `verify_all_requirements.ts` validating:
  - Role authentication & rejection of unauthenticated requests (`401`).
  - Cross-role authorization limits (`403 Forbidden`).
  - Multi-doctor consultations on canonical patient profiles.
  - C++ priority queue ordering (`Emergency -> Senior -> Normal`).
  - Patient personal portal authorization boundaries.
  - Doctor-wise patient analytics and unique vs. total visit mathematics.
  - PDFKit prescription compilation & file integrity.
  - Telegram recipient phone resolution and link code verification.
  - Conflict-free appointment cancellations.
  - Real-time live queue position calculations (`#X in line`).
  - Microservices telemetry for FastAPI AI service & C++ engine.
- **C++ Unit Tests (`cpp-core/tests/`):**
  - `test-queue`: Validates priority comparator and stable sorting across priority ranks.
  - `test-appointments`: Validates half-open slot intervals, lunch hour exclusion, and capacity rules.
- **Python AI Tests (`ai-service/tests/`):**
  - `test_rag.py`: Tests document chunking, BM25 retrieval accuracy, and health endpoints.

---

## 13. Deployment & CI/CD

### Deployment Architecture
- **Web Client:** Can be hosted on Vercel, Netlify, Firebase Hosting, or Cloudflare Pages.
- **Integration API:** Node.js container (AWS ECS, Google Cloud Run, or DigitalOcean Droplet).
- **AI Microservice:** Python ASGI container (AWS ECS, Cloud Run, or Fly.io).
- **C++ Engine:** Compiled as native binary (`clinicqueue-engine`) and bundled inside the Node.js container.

### Production Environment Differences
- In production, set `NODE_TLS_REJECT_UNAUTHORIZED=1`.
- Replace Telegram long-polling with HTTPS Webhook (`POST /api/telegram/webhook`) secured with `X-Telegram-Bot-Api-Secret-Token`.
- Store service account credentials in secret managers (e.g. Google Secret Manager, AWS Secrets Manager) rather than local `.json` files.

---

## 14. Error Handling & Logging

### Error Patterns
- **API Errors:** Structured JSON responses `{ "message": "Detailed error message" }`.
- **HTTP Status Codes:**
  - `400 Bad Request`: Validation failure, missing fields, or invalid patient age.
  - `401 Unauthorized`: Missing or expired Firebase ID token.
  - `403 Forbidden`: Authenticated user lacks required role permissions.
  - `404 Not Found`: Entity not found in Firestore.
  - `409 Conflict`: Appointment slot already booked or out-of-order queue call attempted.
  - `500 Internal Server Error`: Unhandled server exceptions caught by `express-async-errors`.
- **Logging:** Standard console output with ISO timestamps and service tags (`[Telegram]`, `[CppEngine]`, `[FastAPI]`).

---

## 15. Known Issues, TODOs & Limitations

1. **Telegram Webhook in Local Dev:** Telegram cannot send webhooks to `localhost`. The integration API uses long-polling in development. Webhooks require a public HTTPS domain.
2. **Compound Firestore Indexes:** Firestore requires composite indexes for complex multi-field equality/inequality queries. The backend intentionally performs primary filtering in Firestore and secondary date/status sorting in memory.
3. **C++ Path on Linux vs Windows:** On Windows, the binary is `clinicqueue-engine.exe`. On Linux/macOS, it compiles to `clinicqueue-engine`. Path is configurable via `CPP_ENGINE_PATH`.

---

## 16. Glossary

- **Healthcare OS:** The unified SaaS operating system interface designed for clinical administration.
- **Triage Priority:** Classification level determining wait order: `EMERGENCY` (Rank 0), `SENIOR` (Rank 1, Age >= 60), `NORMAL` (Rank 2).
- **Half-Open Interval:** Mathematical time interval `[start, end)` where the start is included and the end is excluded.
- **Canonical Patient:** A single, unique patient profile with a permanent `patientId` that can consult multiple specialists over time.
- **Family Account:** A Telegram account linking multiple patients under a single chat ID.
- **BM25:** Best Matching 25, a probabilistic ranking function used in document retrieval.
- **RAG:** Retrieval-Augmented Generation, combining search with LLMs to generate grounded answers.

---

## 17. File-by-File Index

### Root Configuration
- `README.md`: High-level project summary and startup guide.
- `start-all.ps1`: Automated PowerShell launcher for all three runtime services.
- `CLINICQUEUE_PROJECT_CONTEXT.md`: Master architectural rules and ground-truth specification.
- `AI_KNOWLEDGE_BASE.md`: AI system guidelines and clinic reference notes.
- `PROJECT_INFORMATION.md`: Complete technical reference knowledge base (this document).

### Frontend (`frontend/src/`)
- `main.tsx`: Client application bootstrap and React root mount.
- `App.tsx`: Top-level route configuration and AuthProvider wrapper.
- `styles.css`: Complete SaaS design system, CSS variables, and layout classes.
- `types.ts`: TypeScript type declarations for patients, appointments, doctors, and queues.
- `components/Layout.tsx`: App shell layout, sidebar navigation, topbar breadcrumbs, and modals.
- `components/Ui.tsx`: Component primitives (StatCard, Card, Badge, Button, Modal, Drawer, EmptyState).
- `components/Icon.tsx`: SVG icon library with Lucide-style iconography.
- `context/AuthContext.tsx`: React Context managing Firebase authentication and user profile state.
- `pages/Dashboard.tsx`: Role-aware Healthcare OS dashboard with Pulse KPI cards and system health.
- `pages/Patients.tsx`: Patient intake wizard with specialization-filtered doctor routing.
- `pages/Appointments.tsx`: Appointments management, conflict-free booking wizard, and drawer details.
- `pages/Queue.tsx`: Live priority queue monitor with #1 Next call action and cancel dialog.
- `pages/Consultation.tsx`: Doctor consultation encounter screen with prescription item builder and Telegram sender.
- `pages/PatientDashboard.tsx`: Patient portal for viewing appointments, queue position, and Telegram link codes.
- `pages/Login.tsx`: Firebase email/password authentication screen with quick demo role autofill.
- `pages/Settings.tsx`: Admin panel for user role assignment and Clinic FAQ document ingestion.
- `services/api.ts`: Axios HTTP client with automatic Firebase Bearer token injection.
- `services/firebase.ts`: Firebase Web SDK client initialization.

### Backend (`integration/src/`)
- `app.ts`: Express application entry point, middleware stack, and Telegram bot initialization.
- `cpp-adapter/CppEngine.ts`: Child process bridge invoking `clinicqueue-engine.exe` via stdio.
- `firebase/admin.ts`: Firebase Admin SDK setup and Cloud Firestore handle.
- `middleware/auth.ts`: Authentication and Role-Based Access Control middleware.
- `routes/appointments.ts`: Appointment CRUD, C++ slot generator, check-in, and atomic booking.
- `routes/auth.ts`: User profile, doctor availability toggle, and admin user creation.
- `routes/consultations.ts`: Consultation encounter logging and past medical history lookups.
- `routes/dashboard.ts`: High-level metrics, doctor-wise workload analytics, and doctor summaries.
- `routes/doctors.ts`: Doctor directory, medical specializations, shift schedules, and holidays.
- `routes/faq.ts`: Admin FAQ document management and RAG query proxy.
- `routes/patientPortal.ts`: Patient self-service endpoints, family listing, and link code generation.
- `routes/patients.ts`: Composite patient intake wizard and demographic lookups.
- `routes/prescriptions.ts`: Prescription creation, PDFKit compiler, and Telegram document sender.
- `routes/queue.ts`: Live queue token management, C++ priority ordering, and calling next patient.
- `routes/telegram.ts`: Webhook receiver for Telegram Bot API.
- `services/pdf.ts`: PDFKit document layout and vector styling for electronic prescriptions.
- `telegram/bot.ts`: Telegram bot instance, router, and message handling.
- `telegram/ui.ts`: Custom Telegram reply keyboards and menus.
- `telegram/commands/start.ts`: `/start` command welcome flow and family account initialization.
- `telegram/commands/faq.ts`: FAQ inquiry handler routing to FastAPI RAG service.
- `telegram/services/FamilyService.ts`: Firestore persistence for multi-member family accounts.
- `telegram/services/SessionService.ts`: Multi-step conversational state machine for Telegram.
- `telegram/workflows/BookingWorkflow.ts`: Step-by-step appointment booking wizard via Telegram.
- `telegram/workflows/QueueWorkflow.ts`: Live queue token status, request, and cancel via Telegram.
- `telegram/workflows/RegistrationWorkflow.ts`: Step-by-step patient registration wizard via Telegram.

### C++ Core Engine (`cpp-core/`)
- `CMakeLists.txt`: Build specification, C++17 configuration, and nlohmann_json dependency.
- `include/Person.h`: Abstract base class for all human entities (OOP Abstraction/Inheritance).
- `include/Patient.h`: Patient domain entity with senior status check.
- `include/Doctor.h`: Doctor domain entity with specialization and duty flags.
- `include/DoctorSchedule.h`: Shift hours, working days, lunch interval, and slot duration struct.
- `include/Appointment.h`: Scheduled appointment interval entity.
- `include/QueueToken.h`: Waiting queue token entity.
- `include/Enums.h`: Enumerations for Role, Priority, TokenStatus, and AppointmentStatus.
- `include/QueueManager.h`: Declaration of deterministic priority sorting algorithm.
- `include/AppointmentService.h`: Declaration of half-open interval slot generator.
- `include/ValidationService.h`: Declaration of appointment conflict validator.
- `src/main.cpp`: CLI wrapper reading JSON from stdin and writing JSON results to stdout.
- `src/QueueManager.cpp`: Implementation of queue priority sorting.
- `src/AppointmentService.cpp`: Implementation of conflict-free slot generation.
- `src/ValidationService.cpp`: Implementation of appointment validation logic.

### AI Microservice (`ai-service/`)
- `requirements.txt`: Python package manifest (FastAPI, Uvicorn, pypdf).
- `app/main.py`: FastAPI server bootstrap and router registration.
- `app/api/health.py`: Health ping and indexed document count endpoint.
- `app/api/rag.py`: Document ingestion (`/rag/ingest`) and BM25 RAG query (`/rag/query`).
- `app/api/nlp.py`: Natural language symptom-to-specialization mapping.
- `app/api/prescription.py`: Prescription clinical assistance endpoint.
- `app/models/schemas.py`: Pydantic request and response schemas.
- `app/services/document_service.py`: Document extraction and disk storage.
- `app/services/rag_service.py`: BM25 token ranker and Groq neural LLM synthesizer.
