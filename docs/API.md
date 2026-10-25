# REST API

Base path: `/api`. All routes except `GET /api/health` and the Telegram webhook
require:

```http
Authorization: Bearer <Firebase ID token>
```

The API verifies token signature and Firebase project claims, then loads the
active user's role from `users/{uid}` in Firestore. Responses use JSON except
prescription PDF downloads. Error bodies are `{ "message": "..." }`.

## Roles

| Route | ADMIN | DOCTOR | RECEPTIONIST |
|---|---:|---:|---:|
| `GET /api/me`, dashboard, patient search, queue read | Yes | Yes | Yes |
| `POST /api/patients` | Yes | No | Yes |
| `GET /api/patients/{id}` | Full history | Full history | Demographics only |
| `POST /api/queue`, `POST /api/queue/{id}/call` | Yes | Call only | Yes |
| `GET /api/consultations` | Yes | Yes | No |
| `POST /api/consultations` | Yes | Yes | No |
| `POST /api/prescriptions`, `GET /api/prescriptions/{id}/pdf` | Yes | Yes | No |
| `POST /api/ai/rag/query` | Yes | Yes | No |
| `POST /api/admin/users` | Yes | No | No |
| `GET /api/admin/rag/documents`, `POST /api/admin/rag/ingest` | Yes | No | No |
| `POST /api/me/availability` | No | Yes | No |

## Endpoints

- `GET /api/health` — process and Firebase/Firestore configuration status (no
  credentials or secrets are returned).
- `GET /api/me` — authenticated user's profile and role.
- `POST /api/admin/users` — create/update an application role for an existing
  Firebase Auth user. Body: `{ "uid", "name", "email", "role", "active",
  "onDuty" }`; `role` is `ADMIN`, `DOCTOR`, or `RECEPTIONIST`.
- `GET /api/admin/rag/documents` — list indexed clinic FAQ source files (ADMIN).
- `POST /api/admin/rag/ingest` — upload one PDF, Markdown, or UTF-8 text file
  as multipart field `file` (ADMIN; maximum 10 MB).
- `POST /api/me/availability` — doctor only. Body: `{ "onDuty": true }`.
- `GET /api/dashboard/stats` — `{ waiting, completed, emergency,
  doctorsAvailable }` for the current UTC day where applicable.
- `GET /api/patients?search=<name-or-phone>` — search patient register.
- `POST /api/patients` — register a patient. Body: `{ name, phone, age,
  gender, notes? }`. Age must be an integer from 0 to 130.
- `GET /api/patients/{id}` — patient detail and, for doctors/admins, consultation
  and prescription metadata.
- `GET /api/queue?status=WAITING|CALLED|COMPLETED` — queue records, ordered by
  emergency/senior/normal priority and FIFO.
- `POST /api/queue` — create a visit. Body: `{ patientId, priority }`, priority
  is `EMERGENCY`, `SENIOR`, or `NORMAL`. Age 60+ is raised to `SENIOR` unless
  emergency.
- `POST /api/queue/{id}/call` — mark the next waiting token called. Returns
  `409` if a higher-priority/earlier token is still waiting.
- `GET /api/consultations?patientId=<id>&queueId=<id>` — filter recorded
  consultation history (ADMIN/DOCTOR).
- `POST /api/consultations` — complete a called queue token. Body:
  `{ queueId, diagnosis, notes? }`.
- `POST /api/prescriptions` — generate a PDF at
  `backend/storage/prescriptions/{id}.pdf`. Firestore stores PDF metadata and a
  relative local path only; PDF contents and medication text are not persisted
  in Firestore. Body:
  `{ consultationId, medications: [{name, dosage, duration}], instructions? }`.
- `GET /api/prescriptions/{id}/pdf` — authenticated PDF download from the
  backend local filesystem.
- `POST /api/ai/rag/query` — authenticated doctor/admin reference retrieval.
  Body: `{ question }`. The C++ API proxies to the configured AI service.
- `POST /api/telegram/webhook` — Telegram Bot API webhook. Configure
  `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`; Telegram must send the
  matching `X-Telegram-Bot-Api-Secret-Token` header. This route is not protected
  by Firebase because Telegram authenticates it with that secret.

Queue/patient/consultation mutations return persisted records and use standard
`201 Created` for new records. Invalid input returns `400`, unauthenticated
requests `401`, disallowed roles `403`, missing records `404`, queue conflicts
`409`, and unavailable upstream/persistence services `502` or `503`.

## Persistence and external services

The backend reads `FIREBASE_PROJECT_ID` and
`GOOGLE_APPLICATION_CREDENTIALS`; the service account only needs Firestore
permissions. Prescription PDFs are stored in
`backend/storage/prescriptions/` and served by the backend. No cloud file
storage configuration is required. Firestore collections and the initial admin
bootstrap procedure are documented in [ARCHITECTURE.md](./ARCHITECTURE.md) and
the root [README.md](../README.md).

Telegram patient self-service and queue-call notifications require
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`. The bot asks patients to
share their own Telegram contact, verifies the Telegram sender matches the
shared contact, and links one phone match to one patient record. This verifies
phone-account possession, not a person's legal identity. The optional
`TELEGRAM_CHAT_ID` continues to receive clinic-wide operational notifications.
Admins upload FAQ source documents from **Settings → Clinic FAQ library**.

The AI service's document ingestion endpoints and storage configuration are
documented in [ai-service/README.md](../ai-service/README.md).
