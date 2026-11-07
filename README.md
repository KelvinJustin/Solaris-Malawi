<p align="center">
  <img src="backend/assets/logo.png" alt="Solaris Malawi" width="480">
</p>

# Solaris Malawi

**Solaris Malawi** is a modern digital payment gateway and merchant management platform designed for the Malawian digital economy. It enables businesses to onboard, complete KYC verification, and accept digital payments through hosted checkout and payment provider integrations.

The repository is organized as a full-stack monorepo comprising:
- **Backend (`/backend`)**: NestJS 12 REST API powering merchant onboarding, authentication, compliance reviews, hosted checkout sessions, provider orchestration, and signed callbacks.
- **Frontend (`/frontend`)**: React 19 single-page merchant portal built with Vite 7, TanStack Router, and Tailwind CSS 4.

---

## Repository Structure

```text
Solaris/
├── backend/                  # NestJS 12 API, Prisma ORM, PostgreSQL, Redis
│   ├── assets/               # Branding assets
│   ├── docs/                 # Architecture, business, database, and dev docs
│   ├── prisma/               # Prisma schema, migrations, and seed scripts
│   ├── src/                  # NestJS modular monolith source code
│   ├── test/                 # E2E and integration tests
│   ├── .env.example          # Backend environment template
│   ├── Dockerfile            # Backend container configuration
│   └── package.json
├── frontend/                 # React 19 + Vite 7 merchant web portal
│   ├── public/               # Static assets & favicon
│   ├── src/                  # Routes, components, API client, hooks
│   ├── .env.example          # Frontend environment template
│   ├── Dockerfile            # Frontend container configuration
│   └── package.json
├── docker-compose.yml        # Orchestrates both backend and frontend
├── Dockerfile                # Root Dockerfile
├── .gitignore                # Global ignore rules
└── README.md                 # Project-wide documentation (this file)
```

---

## Feature Overview

| Area | Status | Key Capabilities |
|---|---|---|
| **Merchant Authentication** | Implemented | Email registration, HMAC-hashed OTP verification, 2FA login, JWT session management via HTTP-only cookies, token revocation. |
| **Merchant Onboarding & KYC** | Implemented | Business profile management (Sole Trader, Partnership, Ltd, NGO), KYC document requests via signed Cloudflare R2 upload URLs, review status lifecycle. |
| **Admin Portal & Compliance** | Implemented | Admin credentials & session management, paginated merchant application review, profile approval, and rejection with audit logging. |
| **Hosted Checkout & Transactions** | Implemented | Transaction creation with idempotency keys, cryptographically secured checkout tokens, public checkout validation, provider initiation. |
| **Payment Provider Integrations** | In Progress (Simulator) | Provider registry with an active simulator adapter, signed HMAC callback verification, duplicate/stale callback race protection. *(Production integrations for Airtel Money, TNM Mpamba, and local bank rails are planned).* |
| **Settlement & Ledgers** | Planned | Schema placeholders exist; financial ledger postings and merchant withdrawal workflows are under active design. |
| **Merchant Dashboard (UI)** | Implemented | Responsive authenticated shell, live onboarding status pill, interactive checklist, business profile summary, login/register/verify-email flows. |

---

## Technology Stack

### Backend
- **Framework:** NestJS 12 on Node.js 24+ (TypeScript 6)
- **Database & ORM:** PostgreSQL with Prisma 7
- **In-Memory Cache:** Redis 6
- **Storage:** Cloudflare R2 (S3-compatible API) for secure KYC document uploads
- **Email:** Nodemailer (Mailpit for local dev, SMTP/Brevo for production)
- **Security & Protection:** Arcjet rate limiting & bot detection, bcrypt password hashing, HMAC OTP storage
- **Testing:** Vitest 4 (unit and e2e)

### Frontend
- **Framework:** React 19, TypeScript
- **Bundler & Dev Server:** Vite 7
- **Routing:** TanStack Router (type-safe file-based routing)
- **Styling:** Tailwind CSS 4, tw-animate-css, clsx, tailwind-merge
- **UI Components:** shadcn/ui components (`components.json`)
- **Testing:** Vitest 3, React Testing Library, jsdom

---

## Prerequisites

- **Node.js**: `v24.x` or higher
- **npm**: `v10.x` or higher
- **Docker & Docker Compose**: For containerized local dev or Redis
- **PostgreSQL**: A running instance (version 15+ recommended) reachable via `DATABASE_URL`
- *(Optional)* **Mailpit**: For local SMTP email capture (`http://localhost:8025`)

---

## Quick Start

### Method 1: Local Development (Two Terminals)

#### 1. Clone the repository
```bash
git clone https://github.com/KelvinJustin/Solaris-Malawi.git
cd Solaris-Malawi
```

#### 2. Configure Backend
```bash
cd backend
cp .env.example .env    # On Windows: Copy-Item .env.example .env
```
Update `backend/.env` with your PostgreSQL database credentials and required secrets.

Install dependencies and run database migrations:
```bash
npm install
npx prisma generate
npx prisma migrate deploy
```

*(Optional)* Seed initial admin and test data:
```bash
npm run seed:admin       # Creates default seed admin
npm run seed:merchants   # Seeds sample merchant accounts
npm run seed:profiles    # Seeds sample merchant profiles
```

Start Redis (if running locally via Docker):
```bash
docker compose up -d redis
```

Start the backend API in development mode:
```bash
npm run start:dev
# API starts at http://localhost:3000 (endpoints under /v1)
```

#### 3. Configure Frontend
Open a new terminal window:
```bash
cd frontend
cp .env.example .env    # On Windows: Copy-Item .env.example .env
npm install
npm run dev
# Frontend starts at http://localhost:5173
```

Open **`http://localhost:5173`** in your browser to access the merchant portal.

---

### Method 2: Docker Compose (Full Stack)

The root [`docker-compose.yml`](./docker-compose.yml) orchestrates both the backend and frontend together with built-in health checks:

1. Ensure `backend/.env` is configured with a valid `DATABASE_URL` reachable from containers (e.g. `host.docker.internal` on Windows/Mac).
2. Start the full application:
   ```bash
   docker compose up --build
   ```
3. Services:
   - **Backend API:** `http://localhost:3000/v1/test`
   - **Frontend UI:** `http://localhost:5173`

---

## Environment Configuration

### Backend (`backend/.env`)

| Variable | Description | Default / Example |
|---|---|---|
| `PORT` | Listening port for NestJS | `3000` |
| `NODE_ENV` | Environment mode | `development` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:pass@localhost:5432/solaris?schema=public` |
| `FRONTEND_URL` | Exact frontend origin for CORS cookies | `http://localhost:5173` |
| `REDIS_HOST` / `REDIS_PORT` | Redis server connection | `localhost` / `6379` |
| `JWT_SECRET` | Secret key for JWT access tokens | 32-byte hex string |
| `OTP_SECRET` | Secret key for HMAC-hashing OTP codes | 32-byte hex string |
| `OTP_TTL_SECONDS` | OTP validity window | `300` (5 minutes) |
| `OTP_RESEND_COOLDOWN_SECONDS` | Minimum wait between OTP resend requests | `60` |
| `OTP_MAX_ATTEMPTS` | Maximum wrong OTP attempts before challenge locks | `5` |
| `ENCRYPTION_SALT` | Work factor for bcrypt hashing | `12` |
| `SMTP_SERVER` / `SMTP_PORT` | Mail server configuration | `127.0.0.1` / `1025` (Mailpit) |
| `SMTP_FROM` | Sender display address | `"Solaris Malawi <no-reply@solaris.local>"` |
| `ARCJET_KEY` / `ARCJET_ENV` | Arcjet rate limiting & security | `development` |
| `R2_ACCOUNT_ID` / `R2_BUCKET_NAME` | Cloudflare R2 storage credentials | KYC document bucket |
| `CHECKOUT_TOKEN_ENCRYPTION_KEY` | 32-byte base64 key for encrypting checkout tokens | Generated base64 string |
| `CHECKOUT_BASE_URL` | Base public URL for hosted checkout links | `http://localhost:3000/v1` |
| `TEST_PROVIDER_BASE_URL` | Endpoint for the test provider simulator | `https://solaris-test-provider.onrender.com` |
| `SIGNING_SECRET` | Secret used to sign & verify webhook payloads | Generated random string |

### Frontend (`frontend/.env`)

| Variable | Description | Default |
|---|---|---|
| `VITE_API_URL` | Base origin of backend API (no trailing slash, no `/v1`) | `http://localhost:3000` |

---

## Architecture & Payment Flow

```text
  Customer / Client App                  Solaris Backend                     Provider Simulator
           │                                   │                                      │
           │  1. Create Transaction (Idempotent)│                                     │
           ├──────────────────────────────────►│                                      │
           │◄──────────────────────────────────┤                                      │
           │   Returns Checkout URL + Token    │                                      │
           │                                   │                                      │
           │  2. Visit Hosted Checkout         │                                      │
           ├──────────────────────────────────►│                                      │
           │◄──────────────────────────────────┤                                      │
           │   Validates Token & Session State │                                      │
           │                                   │                                      │
           │  3. Submit Payment (Pay)          │                                      │
           ├──────────────────────────────────►│  4. Initiate Payment Attempt         │
           │                                   ├─────────────────────────────────────►│
           │                                   │◄─────────────────────────────────────┤
           │                                   │   Initial Status: ACCEPTED/UNKNOWN   │
           │                                   │                                      │
           │                                   │  5. Asynchronous Webhook Callback    │
           │                                   │◄─────────────────────────────────────┤
           │                                   │   Verifies HMAC & Updates Record     │
```

---

## Testing

```bash
# Run backend tests (Vitest 4)
cd backend
npm run test          # Run unit tests
npm run test:watch    # Watch mode
npm run test:cov      # Coverage report
npm run test:e2e      # End-to-end integration tests

# Run frontend tests (Vitest 3)
cd frontend
npm test              # Run unit and component tests
npm run test:watch    # Watch mode
```

---

## Documentation Directory

Comprehensive technical and domain documentation is available in `backend/docs/`:

- [**Architecture Overview**](./backend/docs/architecture/overview.md) — Modular monolith design, guards, and system interactions
- [**Auth Contract**](./backend/docs/architecture/authContract.md) — Cookie-based authentication and security specifications
- [**Development Setup**](./backend/docs/development/setup.md) — Local prerequisites, tooling, and database preparation
- [**Database Setup**](./backend/docs/database/setup.md) — Prisma schema details, migrations, and PostgreSQL setup
- [**Product Overview**](./backend/docs/business/product-overview.md) — Product vision, merchant personas, and market positioning
- [**Backend Documentation**](./backend/README.md) — Dedicated backend guide and API endpoint catalog
- [**Frontend Documentation**](./frontend/README.md) — Dedicated frontend guide, routing structure, and UI patterns

---

## License

This project is currently marked `UNLICENSED` in `package.json`.
