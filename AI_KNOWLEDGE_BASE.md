# ClinicQueue - Project Knowledge Base

> 💡 **FOR AI AGENTS (ChatGPT, Claude, Cursor, DeepSeek):**
> Please refer to the complete, self-contained master architecture and context prompt:
> 👉 **[`CLINICQUEUE_PROJECT_CONTEXT.md`](./CLINICQUEUE_PROJECT_CONTEXT.md)**
> It contains the full Firestore schema, C++ IPC protocol, RBAC logic, composite patient intake rules, Telegram bot workflows, and system constraints.

This document serves as a quick developer reference for the **ClinicQueue** project.

## 1. High-Level Architecture

ClinicQueue is a multi-tier clinic management system with the following architecture:

*   **Frontend**: React 19 + TypeScript + Vite.
*   **Integration API & Bot**: Node.js + Express + TypeScript + Firebase Admin SDK.
*   **Core Domain Engine**: Pure C++17 OOP CLI executable (`clinicqueue-engine.exe`).
*   **AI/NLP Service**: Python 3.11+ + FastAPI.
*   **Database & Auth**: Google Firebase (Firestore + Firebase Authentication).
*   **External Integrations**: Telegram Bot API for multi-member family registration, booking, and prescription delivery.

### Data Flow
1. **Web App**: The React app proxies all `/api` requests to the Node.js integration API (`http://localhost:3000`).
2. **Node.js Integration API**: Validates auth tokens using Firebase Auth, processes RBAC, manages Telegram Bot polling, generates PDFKit prescriptions, and reads/writes to Firestore via Admin SDK.
3. **C++ Engine**: Pure C++17 domain logic invoked via Node.js stdio child process for computing complex available appointment slots, token queue priority ordering, and appointment validation.
4. **AI Service**: The Node.js backend delegates natural language triage and RAG FAQ search to the Python FastAPI service (`http://127.0.0.1:8001`).
5. **Telegram Bot**: Long-polling hosted directly inside the Node.js service (`integration/src/telegram/bot.ts`).

---

## 2. Technical Stack Details

### Frontend (`/frontend`)
*   **Framework**: React 19, TypeScript, Vite.
*   **Routing**: React Router (`/`, `/dashboard`, `/appointments`, `/patients`, `/queue`, `/settings`).
*   **State & API**: Custom React services injecting Firebase ID tokens into the `Authorization: Bearer` header.

### Integration API (`/integration`)
*   **Language/Framework**: Node.js, Express, TypeScript.
*   **Core Modules**:
    *   `auth`, `dashboard`, `appointments`, `doctors`, `queue`, `prescriptions`, `patientPortal`, `faq`.
    *   `FamilyService`: Multi-member family account management, linking, and authorized chat ID resolution.
    *   `SessionService`: Telegram conversational state machine.
    *   `CppEngine`: Child process bridge to `clinicqueue-engine.exe`.

### Core Domain Engine (`/cpp-core`)
*   **Language**: Pure C++17, CMake, `nlohmann/json`.
*   **Capabilities**:
    *   `generateSlots`: Computes available consultation time slots based on working days, doctor hours, lunch breaks, and existing bookings.
    *   `orderQueue`: Orders waiting queue tokens by priority (EMERGENCY > SENIOR > NORMAL) and check-in timestamp.
    *   `validateAppointment`: Validates appointment booking constraints.

### AI Service (`/ai-service`)
*   **Language/Framework**: Python 3.11+, FastAPI, Uvicorn.
*   **Capabilities**:
    *   `/nlp/specialization`: Uses Groq API (LLaMa 3.1) to map patient symptoms to exact medical specializations.
    *   `/rag/query`: Answers clinic FAQs using BM25 document indexing.

---

## 3. Core Features & Implementation

### A. Doctor Scheduling & Time Slots
1. **Schedules**: Stored in `doctor_schedules`. Defines `startTime`, `endTime`, `lunchStart`, `lunchEnd`, `workingDays`, and `slotDurationMinutes`.
2. **Holidays**: Stored in `doctor_holidays`. Specific dates a doctor is unavailable.
3. **Slot Generation**: The C++ engine dynamically generates slots for a specific date, skipping past times, lunch breaks, and already booked appointments.

### B. Telegram Bot Multi-step Workflow
*   **Family Registration**: 5-step registration (Name, Age, Gender, Phone, Relationship) supporting multiple family members under a single Telegram account.
*   **Pre-Booking Selection**: "Who needs an appointment?" prompt assigns the appointment to the selected family member's canonical `patientId`.
*   **Prescription Delivery**: Automatically sends generated prescription PDFs to the patient's verified Telegram chat with zero doctor friction.

---

## 4. Development & Running Locally

1. **All-in-One Startup**:
   ```powershell
   .\start-all.ps1
   ```
2. **Ports**:
   *   Frontend: `http://localhost:5173`
   *   Integration API: `http://localhost:3000`
   *   AI Service: `http://127.0.0.1:8001`
