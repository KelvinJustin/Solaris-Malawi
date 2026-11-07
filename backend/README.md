<p align="center">
  <img src="assets/logo.png" alt="Solaris Malawi" width="400">
</p>

# Solaris Malawi — Backend

The **Solaris Malawi Backend** is a NestJS 12 modular monolith providing a payment gateway API for the Malawian digital economy. It manages merchant authentication, onboarding and KYC compliance, administrative reviews, hosted checkout sessions, payment provider orchestration, and signed callback verification.

> **Looking for the full-stack setup?** See the project-wide [Root README](../README.md) for instructions on running both the backend and frontend together.

---

## Current Status & Capabilities

### Implemented
- **Merchant Auth:** Registration, HMAC-based OTP verification, 2FA login, logout, and JWT session handling via HTTP-only cookies.
- **Merchant Profiles & KYC:** Profile creation/updates across business types (`SOLE_TRADER`, `PARTNERSHIP`, `LIMITED_COMPANY`, `NGO`), document upload flow via signed Cloudflare R2 URLs, and status lifecycle (`INCOMPLETE`, `SUBMITTED`, `IN_REVIEW`, `APPROVED`, `REJECTED`).
- **Admin Review:** Admin authentication, paginated merchant applications listing, review assignment, and approve/reject workflows with audit history.
- **Transactions & Hosted Checkout:** Cryptographically encrypted checkout tokens, idempotent transaction creation, hosted checkout session validation, and payment initiation.
- **Provider Orchestration:** Provider registry with an active simulator/test adapter, signed provider webhook callback handling with HMAC verification, and idempotency guards against stale/duplicate events.
- **Persistence:** Relational modeling for merchants, profiles, documents, transactions, and payment attempts via Prisma 7 & PostgreSQL.

### Roadmap / Not Yet Implemented
- Live telecom & bank provider adapters (Airtel Money OpenAPI, TNM Mpamba, National Bank, Standard Bank).
- Automated settlement, ledger balance posting, and merchant withdrawal workflows.

---

## Architecture & Modules

The backend is structured as a modular monolith where each domain feature is an isolated NestJS module under `src/`:

```text
Clients (Frontend / Merchant API)
  │
  ▼
Solaris API (/v1)
  │
  ├── auth/                 # Merchant registration, OTP, 2FA login, JWT cookies
  ├── merchants/            # Business profile management & KYC document handling
  ├── admin-auth/           # Internal admin login, logout, & cookie management
  ├── admin/                # Merchant application review and approvals
  ├── transactions/         # Payment transactions & hosted checkout flow
  ├── payment-providers/    # Provider registry & test simulator adapter
  ├── provider-callbacks/   # Signed webhook callback verification
  ├── storage/              # Cloudflare R2 pre-signed upload URLs
  ├── email/                # Nodemailer SMTP email delivery service
  ├── arcjet/               # Rate limiting, bot protection, & attack shielding
  └── database/             # Prisma client service & DB connection lifecycle
  │
  ▼
PostgreSQL 15+ (Prisma 7)  +  Redis 6 (Cache & Session Revocation)
```

### Module Responsibilities

| Module | Primary Responsibility |
|---|---|
| `auth` | Merchant registration, OTP issuance & validation, password hashing, JWT issue/revocation. |
| `merchants` | Business entity validation, KYC document requirements per business type, submission rules. |
| `admin-auth` | Admin credential verification, role assignment (`SUPER_ADMIN`, `COMPLIANCE`, `SUPPORT`), auth cookies. |
| `admin` | Application queueing, starting reviews, approving profiles, rejecting profiles with audit logs. |
| `transactions` | Idempotent transaction generation, checkout session initialization, customer payment initiation. |
| `payment-providers` | Provider adapter abstraction, payload transformation, dispatching calls to provider gateway. |
| `provider-callbacks` | Cryptographic signature verification, idempotent payment success/failure state transitions. |
| `storage` | Cloudflare R2 S3-compatible client, generating pre-signed PUT URLs for KYC uploads. |
| `email` | Transactional email delivery (registration OTP, login verification codes). |
| `arcjet` | Security middleware guarding against brute force attacks and malicious clients. |
| `database` | PostgreSQL connection pooling, Prisma client management, and health check integration. |

---

## Tech Stack

- **Runtime:** Node.js 24+
- **Language:** TypeScript 6
- **Framework:** NestJS 12
- **ORM:** Prisma 7
- **Database:** PostgreSQL
- **Cache:** Redis 6
- **Security:** Arcjet, bcrypt, crypto HMAC
- **File Storage:** Cloudflare R2 (AWS S3 SDK)
- **Testing:** Vitest 4, Supertest

---

## Local Setup

### 1. Prerequisites
- Node.js 24+ and npm
- PostgreSQL running locally or in Docker
- Redis running locally or in Docker

### 2. Environment Configuration
From the `backend/` directory, copy the environment file:
```bash
cp .env.example .env    # On Windows: Copy-Item .env.example .env
```

Review and configure your `backend/.env` file. Essential configuration includes:
- `DATABASE_URL`: Connection string to your PostgreSQL instance.
- `FRONTEND_URL`: URL of the merchant dashboard (`http://localhost:5173`) for credentialed CORS.
- `JWT_SECRET` & `OTP_SECRET`: Secure random hex strings.
- `CHECKOUT_TOKEN_ENCRYPTION_KEY`: 32-byte Base64-encoded AES key.
- `SIGNING_SECRET`: Secret used for HMAC webhook verification.

### 3. Install Dependencies & Migrate Database
```bash
npm install
npx prisma generate
npx prisma migrate deploy
```

### 4. Seed Data (Optional)
```bash
npm run seed:admin       # Creates default seed admin (seed.admin@solaris.local / DevAdminPassword123!)
npm run seed:merchants   # Seeds test merchant accounts
npm run seed:profiles    # Seeds sample merchant business profiles
```

### 5. Start Redis
If using Docker for Redis:
```bash
docker compose up -d redis
```

### 6. Run the Application
```bash
# Development mode with hot-reload
npm run start:dev

# Production build and run
npm run build
npm run start:prod
```
The API will be available at `http://localhost:3000` with all routes prefixed with `/v1`.

---

## API Catalog

All routes are versioned under `/v1`.

### Merchant Authentication (`/v1/auth`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/auth/register` | Public | Register new merchant with email, password, and business name. |
| `POST` | `/v1/auth/verify-email` | Public | Verify registration OTP sent via email. |
| `POST` | `/v1/auth/resend-verification` | Public | Resend email registration verification code. |
| `POST` | `/v1/auth/login` | Public | Verify credentials and send 2FA OTP code. |
| `POST` | `/v1/auth/verify-login` | Public | Validate 2FA OTP and issue HTTP-only `access_token` cookie. |
| `GET` | `/v1/auth/me` | Cookie | Retrieve current authenticated merchant profile. |
| `POST` | `/v1/auth/logout` | Cookie | Invalidate JWT, add token to revocation table, and clear cookie. |

### Merchant Profile & KYC (`/v1/merchants`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/v1/merchants/profile` | Cookie | Get current merchant profile and onboarding status. |
| `PATCH` | `/v1/merchants/profile` | Cookie | Update editable profile fields. |
| `POST` | `/v1/merchants/profile/submit` | Cookie | Submit profile and uploaded KYC documents for review. |
| `POST` | `/v1/merchants/documents/upload-url` | Cookie | Request pre-signed Cloudflare R2 upload URL for a KYC document. |
| `POST` | `/v1/merchants/documents/:uploadId/complete` | Cookie | Confirm file upload completion and attach to profile. |
| `GET` | `/v1/merchants/documents` | Cookie | List all uploaded KYC documents and their statuses. |

### Admin & Compliance (`/v1/admin` & `/v1/admin-auth`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/admin-auth/login` | Public | Admin login; sets HTTP-only `admin_access_token` cookie. |
| `POST` | `/v1/admin-auth/logout` | Cookie | Revoke admin session and clear cookie. |
| `GET` | `/v1/admin-auth/me` | Cookie | Return current admin identity and role. |
| `GET` | `/v1/admin/merchant-applications` | Admin | List paginated merchant applications with filters. |
| `GET` | `/v1/admin/merchant-applications/:profileId` | Admin | Detailed view of a merchant profile and documents. |
| `POST` | `/v1/admin/merchant-applications/:profileId/start-review` | Admin | Lock application into `IN_REVIEW` status. |
| `POST` | `/v1/admin/merchant-applications/:profileId/approve` | Admin | Approve merchant application. |
| `POST` | `/v1/admin/merchant-applications/:profileId/reject` | Admin | Reject merchant application with mandatory reason. |

### Transactions & Checkout (`/v1/transactions` & `/v1/checkout`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/transactions` | ApiKey / Cookie | Create a transaction with an `Idempotency-Key` header. |
| `GET` | `/v1/transactions/:reference` | Cookie | Fetch transaction status and payment attempt history. |
| `GET` | `/v1/checkout/:token` | Public | Validate and retrieve hosted checkout session details. |
| `POST` | `/v1/checkout/:token/pay` | Public | Initiate payment through selected provider. |
| `POST` | `/v1/provider-callbacks` | Signed | Webhook endpoint receiving signed provider callbacks. |

---

## Testing

```bash
# Unit tests
npm run test

# Watch mode
npm run test:watch

# Code coverage report
npm run test:cov

# End-to-end (E2E) tests
npm run test:e2e
```

---

## Code Quality & Formatting

```bash
# Type-aware linting with oxlint
npm run lint

# Format code with Prettier
npm run format
```

---

## Documentation

Detailed technical documents are stored in the `docs/` directory:
- [Architecture Overview](./docs/architecture/overview.md)
- [Auth Contract & Cookies](./docs/architecture/authContract.md)
- [Database Schema & Migrations](./docs/database/setup.md)
- [Development Workflow & Setup](./docs/development/setup.md)
- [Unit Testing Architecture](./docs/development/unitTesting.md)
- [Business Product Context](./docs/business/product-overview.md)
