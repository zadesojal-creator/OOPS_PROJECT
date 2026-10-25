# ClinicQueue Architecture 2.0

This document outlines the modernized architecture of the ClinicQueue project, migrated from the legacy Qt6 HTTP server model.

## 1. System Components

The system is broken down into four distinct, highly cohesive components:

### Frontend (`/frontend`)
*   **Tech Stack**: React 18, TypeScript, Vite, TailwindCSS.
*   **Role**: Presents the user interface for patients, receptionists, doctors, and admins.
*   **Communication**: Makes REST HTTP calls exclusively to the Node.js Integration API (`/api/*`).

### Integration API (`/integration`)
*   **Tech Stack**: Node.js, Express, TypeScript, Firebase Admin SDK.
*   **Role**: The central orchestrator and security gateway.
    *   Verifies Firebase Authentication tokens.
    *   Enforces Role-Based Access Control (RBAC).
    *   Communicates directly with Firestore (bypassing client-side rules).
    *   Hosts the Telegram Bot logic using polling/webhooks.
*   **Communication**: Serves HTTP requests from the frontend. Proxies complex AI tasks to the Python service. Spawns the C++ Engine for core domain logic.

### Core Domain Engine (`/cpp-core`)
*   **Tech Stack**: Pure C++17, CMake, `nlohmann/json`.
*   **Role**: A high-performance, purely Object-Oriented engine encapsulating the clinic's core business logic.
    *   Calculates queue priorities.
    *   Generates available appointment slots based on complex constraints (schedules, holidays, lunch breaks, current bookings).
*   **Communication**: Invoked via Node.js `child_process.spawn`. Reads JSON from standard input (`stdin`) and writes JSON to standard output (`stdout`). Completely independent of network, HTTP, or database libraries.

### AI Service (`/ai-service`)
*   **Tech Stack**: Python 3.11+, FastAPI, Groq API.
*   **Role**: NLP and RAG (Retrieval-Augmented Generation).
    *   Maps patient symptoms to clinical specializations (e.g., "headache" -> "Neurologist").
    *   Answers clinic FAQs using ingested documents.

---

## 2. Request Data Flow Example (Booking an Appointment)

1.  **Patient (React / Telegram)** requests available slots for Dr. Smith on `2026-10-20`.
2.  **Node.js API** receives the request and verifies the patient's identity.
3.  **Node.js API** fetches Dr. Smith's schedule, holidays, and existing appointments from Firestore.
4.  **Node.js API** packages this data into a JSON string and spawns the **C++ Engine**.
5.  **C++ Engine** parses the JSON, applies OOP business rules, calculates available time slots, and prints the result as JSON to `stdout`.
6.  **Node.js API** reads the `stdout` and sends the available slots back to the **Patient**.

---

## 3. Database Security Strategy

Because the React frontend talks only to the Node.js API, and the Node.js API uses the privileged Firebase Admin SDK, we completely lock down direct database access.

Our `firestore.rules` file is:
```javascript
match /{document=**} {
  allow read, write: if false;
}
```
This ensures malicious actors cannot bypass the backend and query the database directly using client-side Firebase libraries.
