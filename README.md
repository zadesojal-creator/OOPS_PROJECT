# ClinicQueue

ClinicQueue is a full-stack clinic operations application. The existing React,
Vite, TypeScript, and Figma-derived design is retained. Clinical data is served
by the C++ API from Firestore; the AI service indexes and retrieves real clinic
reference documents.

## Services

- **Frontend:** React 19, Vite, TypeScript, Firebase Authentication (`frontend/`, port 5173)
- **Integration REST API & Telegram Bot:** Node.js, Express, TypeScript, Firebase Admin SDK (`integration/`, port 3000)
- **Core Domain Engine:** Pure C++17 OOP engine (`cpp-core/`, compiled to `clinicqueue-engine.exe`)
- **Persistent Data:** Cloud Firestore, authenticated with Google Service Account
- **Prescription Documents:** Generated PDFs in `integration/storage/prescriptions/` (PDFKit) and delivered automatically via Telegram Bot
- **AI References & Triage:** Python FastAPI document ingestion, BM25 retrieval, and Groq NLP (`ai-service/`, port 8001)
- **Patient & Family Telegram Bot:** Telegram Bot API with multi-member family management

## Prerequisites

- Node.js 20+
- Python 3.11+
- CMake 3.21+ and a C++17 compiler (MSVC or GCC/Clang)
- A Firebase project with Email/Password Authentication and Firestore

## Configure Firebase

1. Enable **Email/Password** in Firebase Authentication and create the first
   administrator in the Firebase console.
2. Create Firestore and use the project ID for `FIREBASE_PROJECT_ID`.
3. Create a service account with **Firestore read/write only** permissions.
   Download its JSON key outside the repository. Set
   `GOOGLE_APPLICATION_CREDENTIALS` to that file in `integration/.env`.
4. After creating the administrator's Auth account, create
   `users/{firebase-uid}` in Firestore with:

   ```json
   {
     "uid": "firebase-auth-uid",
     "name": "Clinic administrator",
     "email": "admin@example.com",
     "role": "ADMIN",
     "active": true,
     "onDuty": false
   }
   ```

   This one-time bootstrap is necessary because role assignment itself is
   protected by the administrator role. Administrators can assign roles to
   subsequently created Firebase Auth users from **Settings → Assign clinic
   role**.
5. Set Firestore client security rules (`firebase/firestore.rules`) to deny direct browser
   access. The web client only signs users in; the backend service account is
   the data access boundary.

## Run locally

The easiest way to start all three services simultaneously is:

```powershell
.\start-all.ps1
```

This launches:
1. **AI Service** (`http://127.0.0.1:8001`)
2. **Node.js Integration API & Telegram Bot** (`http://localhost:3000`)
3. **React Frontend** (`http://localhost:5173`)

### Individual Service Setup

#### 1. Integration API & Telegram Bot
```powershell
cd integration
npm install
npm run dev
```

#### 2. AI Service
```powershell
cd ai-service
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

#### 3. React Frontend
```powershell
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173`. Vite proxies `/api` requests to `http://localhost:3000`.

## Workflows

- Receptionists and administrators can register/search patients and add a
  patient to the queue. Patients aged 60+ are assigned **SENIOR** unless the
  token is explicitly **EMERGENCY**.
- Queue order is **EMERGENCY → SENIOR → NORMAL**, FIFO by Firestore server
  creation time within a priority. The API rejects calls out of order.
- Doctors call patients, save a consultation, generate a prescription PDF in
  `backend/storage/prescriptions/`, and download it through the authenticated
  API. Firestore stores PDF metadata and the relative local path, not the PDF
  contents. Administrators can perform doctor actions.
- Doctors can mark themselves on/off duty; dashboard counts use active,
  on-duty doctor profiles.
- Telegram notifications are sent for queue registration, consultation
  completion, and prescription creation when both Telegram variables are set.
  A failed notification is returned/logged without undoing the saved visit.
- Patients can use the Telegram bot to register, request/cancel a queue token,
  check token status/position, view their basic details, and receive an alert
  when called. The bot links existing records only after the user shares their
  own Telegram contact and its phone matches exactly one patient record.
- Clinic admins can upload PDF, Markdown, or UTF-8 text files in **Settings →
  Clinic FAQ library**. The Telegram FAQ uses only relevant passages from those
  indexed files and directs patients to staff when the information is missing.

## Configuration

See [frontend/.env.example](./frontend/.env.example) and
[backend/.env.example](./backend/.env.example). The backend requires:

- `FIREBASE_PROJECT_ID`
- `GOOGLE_APPLICATION_CREDENTIALS`

Optional backend variables are `API_PORT`, `API_BIND_ADDRESS`,
`AI_SERVICE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and
`TELEGRAM_WEBHOOK_SECRET`. The token and webhook secret enable patient bot
workflows; the chat ID optionally enables clinic-wide notifications. Keep all
server credentials in server-only environment/configuration.

Telegram requires a publicly reachable HTTPS reverse proxy to
`/api/telegram/webhook`. Set `TELEGRAM_WEBHOOK_SECRET` to a random value of at
least 32 characters, then register the webhook with Telegram (PowerShell):

```powershell
$body = @{
  url = "https://your-domain.example/api/telegram/webhook"
  secret_token = $env:TELEGRAM_WEBHOOK_SECRET
} | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri "https://api.telegram.org/bot$env:TELEGRAM_BOT_TOKEN/setWebhook" `
  -ContentType "application/json" -Body $body
```

Telegram contact sharing confirms possession of the phone number associated
with that Telegram account; it is not independent identity proof. Records with
duplicate phone matches must be resolved by clinic staff.

Existing prescription metadata from an older deployment is not migrated
automatically. Export any historical PDFs you need into
`backend/storage/prescriptions/` and update their Firestore records to the
current local `filePath` and `sizeBytes` metadata before relying on those
downloads.

## Tests

- C++: use the VS Code CMake Tools **Run Tests** command after configure/build
- AI service: `python -m unittest discover -s tests -v` from `ai-service`
- Frontend: `npm run build` from `frontend` (includes strict TypeScript
  compilation)

API routes and role requirements are listed in [docs/API.md](./docs/API.md).
The service boundaries and persistence model are in
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).
