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
- **Separated Auth Features:** Merchant and admin authentication are grouped under `src/auth/merchant-auth/` and `src/auth/admin-auth/`; their API routes remain `/v1/auth/*` and `/v1/admin-auth/*`.
- **Merchant Profiles & KYC:** Profile creation/updates across business types (`INDIVIDUAL`, `SOLE_TRADER`, `PARTNERSHIP`, `LIMITED_COMPANY`, `NGO`), document upload via signed S3-compatible URLs (MinIO locally; Cloudflare R2 in production), and status lifecycle (`PENDING_SUBMISSION`, `SUBMITTED`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`, `SUSPENDED`).
- **Admin Review:** Admin authentication, paginated merchant applications listing, review assignment, and approve/reject workflows with audit history.
- **Transactions & Hosted Checkout:** Cryptographically encrypted checkout tokens, idempotent transaction creation, hosted checkout session validation, and payment initiation.
- **Provider Orchestration:** A shared adapter contract and registry with a test adapter and a NOWPayments crypto adapter. Signed callback/IPN handling includes signature checks, guarded lifecycle transitions, and duplicate-event protection.
- **NOWPayments + FX:** Crypto payment instructions are created from an MWK transaction using a configured FX quote; IPN success posts through the ledger. This is implemented and tested locally, but has not been validated against a live NOWPayments sandbox or production endpoint.
- **Persistence:** Relational modeling for merchants, payment lifecycle, versioned fee policies, and immutable double-entry payment postings via Prisma 7 & PostgreSQL.
- **Settlement Reconciliation:** Provider-neutral normalized provider and bank statement imports, payment matching, allocation, and approval/posting workflow. Provider- and bank-specific parsers remain integration points until real sanitized reports and documentation are available.

### Roadmap / Not Yet Implemented
- Live Airtel Money, TNM Mpamba, and bank adapters/parsers. Do not infer their report formats or reference conventions without provider/bank documentation and sanitized samples.
- Merchant fund release, withdrawals, refunds, reversals, available-balance operations, and public merchant balance APIs.
- Live NOWPayments sandbox/production verification and operational confirmation of public IPN reachability and FX source freshness.

### V1 Ledger Foundation
Successful signed callbacks post balanced entries synchronously in the same PostgreSQL transaction as payment and attempt state changes. Payment creation stores an immutable fee snapshot using the active merchant override or platform default; the migration seeds a ZERO/MWK platform policy. Provider-clearing accounts represent receivables, not settled cash. Legacy `MerchantLedger` balances are reported for reconciliation only and are never converted into opening balances.

No fee or ledger posting API is exposed. From `backend/`, create a new controlled policy version with the `seed:fees` command; new policies are inactive unless `--activate` is specified. The version and activation changes are audited.

```bash
npm run seed:fees -- --type PERCENTAGE --percentage-bps 200 --version 2 --source "approved pricing change" --activate
npm run seed:fees -- --type FIXED --fixed-tambala 50000 --version 1 --merchant-id <merchant-uuid> --source "approved merchant agreement" --activate
```

The historical backfill is report-only by default. Review its report and reconcile settlement, withdrawal, refund, adjustment, and legacy balances before applying or treating pending balances as authoritative.

```bash
npm run ledger:backfill
npm run ledger:backfill -- --apply
```

Provider-neutral settlement reconciliation and controlled posting are implemented separately from payment capture. Provider/bank-specific statement parsers, merchant fund release, withdrawals, refunds, available-balance operations, and public ledger APIs are not implemented.

The NOWPayments adapter is registered alongside the test adapter. It accepts a crypto `payCurrency` at checkout, converts the merchant transaction's MWK amount into the configured price currency, creates a provider payment, stores the returned address/amount and FX snapshot, and returns payment instructions. The public IPN route is `/v1/provider-callbacks/nowpayments`; callbacks require a valid `x-nowpayments-sig` signature. Stale in-flight payments are also reconciled by polling NOWPayments while the API key is configured. A `finished` result transitions payment state and posts the crypto ledger capture atomically. `NOWPAYMENTS_FEE_BPS` defaults to 0 until a crypto fee rate is approved. Partial payments enter pending reconciliation. A refund IPN received after success is retained for manual handling; it does not change the successful state or automatically reverse the ledger.

The FX provider polls `open.er-api.com` by default every 15 seconds and caches rates in process memory. The upstream publishes rates daily, so the 300-second default age check measures when this process fetched the quote, not the upstream publication age. It does **not** prove that the underlying rate is current; treat this as a readiness limitation.

---

## Architecture & Modules

The backend is structured as a modular monolith where each domain feature is an isolated NestJS module under `src/`:

```text
Clients (Frontend / Merchant API)
  │
  ▼
Solaris API (/v1)
  │
  ├── auth/
  │   ├── merchant-auth/    # Merchant registration, OTP, 2FA login, JWT cookies
  │   └── admin-auth/       # Admin login, roles, and admin JWT
  ├── merchants/            # Business profile management & KYC document handling
  ├── admin/                # Merchant application review and approvals
  ├── transactions/         # Payment transactions & hosted checkout flow
  ├── payment-providers/    # Provider registry, test and NOWPayments adapters
  ├── fx/                   # MWK conversion-rate provider used for crypto quotes
  ├── config/               # Namespaced FX and NOWPayments configuration
  ├── provider-callbacks/   # Signed webhook callback verification
  ├── settlements/          # Provider-neutral reconciliation and posting workflow
  ├── ledger/               # Fee snapshots and immutable double-entry posting
  ├── storage/              # S3-compatible pre-signed upload URLs
  ├── email/                # Nodemailer SMTP email delivery service
  ├── arcjet/               # Rate limiting, bot protection, & attack shielding
  └── database/             # Prisma client service & DB connection lifecycle
  │
  ▼
PostgreSQL 15+ (Prisma 7)  +  optional Redis Compose service (not currently used by backend modules)
```

Authentication source layout:

```text
src/auth/
  merchant-auth/            # Merchant module, DTOs, current-user decorator
    jwt/                    # Merchant JWT strategy and guard
  admin-auth/               # Admin module, DTOs, and role authorization
    jwt/                    # Admin JWT strategy and guard
```

The feature modules are registered independently; moving them under `auth/` does not change their public route prefixes.

### Module Responsibilities

| Module | Primary Responsibility |
|---|---|
| `auth/merchant-auth` | Merchant registration, OTP issuance & validation, password hashing, JWT issue/revocation. |
| `auth/admin-auth` | Admin credential verification, role authorization, auth cookies, and JWT validation. |
| `merchants` | Business entity validation, KYC document requirements per business type, submission rules. |
| `admin` | Application queueing, starting reviews, approving profiles, rejecting profiles with audit logs. |
| `transactions` | Idempotent transaction generation, checkout session initialization, customer payment initiation. |
| `payment-providers` | Provider adapter abstraction and registry; includes test and NOWPayments integrations. |
| `fx` / `config` | In-process MWK FX quotes and namespaced adapter configuration. |
| `provider-callbacks` | Cryptographic signature verification, idempotent payment success/failure state transitions. |
| `ledger` | Versioned fee snapshots, double-entry payment posting, and historical backfill primitives. |
| `settlements` | Normalized provider/bank imports, matching, allocations, approvals, and posting; provider-specific parsers are not included. |
| `storage` | S3-compatible client, generating pre-signed PUT URLs for KYC uploads (MinIO locally; Cloudflare R2 in production). |
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
- **Infrastructure:** Redis is included in Docker Compose but has no current application integration.
- **Security:** Arcjet, bcrypt, crypto HMAC
- **File Storage:** S3-compatible storage through AWS S3 SDK (MinIO locally; Cloudflare R2 in production)
- **Testing:** Vitest 4, Supertest

---

## Local Setup

### 1. Prerequisites
- Node.js 24+ and npm
- PostgreSQL running locally or in Docker
- MinIO (or another configured S3-compatible service) when using the example local storage settings

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

For NOWPayments, configure `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `NOWPAYMENTS_BASE_URL`, and `PUBLIC_API_BASE_URL`. The public API URL must use reachable HTTPS for sandbox IPNs as well as production. `NOWPAYMENTS_FEE_BPS` sets the approved crypto fee (basis points; defaults to `0`), and `NOWPAYMENTS_PRICE_CURRENCY` defaults to `usd`. `NOWPAYMENTS_MAX_FX_QUOTE_AGE_SECONDS` defaults to `300`; `FX_RATE_API_BASE_URL` defaults to `https://open.er-api.com/v6/latest`; and `FX_RATE_POLL_INTERVAL_MS` defaults to `15000`. Because the upstream feed republishes daily, local fetch age is not proof of underlying rate freshness. Never commit actual credentials.

### 3. Install Dependencies & Migrate Database
```bash
npm install
npx prisma generate --config prisma7.config.ts
npx prisma migrate deploy --config prisma7.config.ts
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

The Compose file starts Redis for its container dependency, but the backend currently has no Redis integration. It does not start PostgreSQL, MinIO, or an SMTP capture service; start those separately or update `.env` to use reachable services.

### 6. Run the Application
```bash
# Development mode with hot-reload
npm run start:dev

# Production build and run
npm run build
npm run start:prod
```
The API will be available at `http://localhost:3000` with all routes prefixed with `/v1`.

### Logging

The backend uses Pino for structured NestJS and HTTP logs. Logs are written as JSON to stdout and to rotating files under `backend/logs` by default. Docker Compose mounts this directory so log files survive container recreation. Configure `LOG_LEVEL` (`info` by default) and `LOG_DIR` (`logs` by default) in the environment. Files rotate daily or at 20 MiB, with up to 14 rotated files retained. HTTP logs use route templates and omit credentials, cookies, and raw checkout tokens.

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
| `DELETE` | `/v1/auth/account` | Cookie | Soft-delete the authenticated merchant account. |

### Merchant Profile & KYC (`/v1/merchants`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/v1/merchants/profile` | Cookie | Get current merchant profile and onboarding status. |
| `PATCH` | `/v1/merchants/profile` | Cookie | Update editable profile fields. |
| `POST` | `/v1/merchants/profile/submit` | Cookie | Submit profile and uploaded KYC documents for review. |
| `POST` | `/v1/merchants/documents/upload-url` | Cookie | Request a pre-signed object-storage upload URL for a KYC document. |
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
| `POST` | `/v1/admin/merchant-applications/:profileId/start-review` | Admin | Move application into `UNDER_REVIEW` status. |
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

Crypto checkout calls `POST /v1/checkout/:token/pay` with `{ "provider": "NOWPAYMENTS", "payCurrency": "..." }`; `network` is optional. On successful invoice creation, the response includes `payment_instructions` with the address, amount, currency, network, and optional expiry.

### NOWPayments Webhook

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/provider-callbacks/nowpayments` | NOWPayments IPN signature | Verifies the `x-nowpayments-sig` signature and processes a payment-status notification. |

### Settlement Operations

Settlement operations are under `/v1/admin/settlements`. Importing normalized provider/bank data, reconciliation, and allocations require `OPERATIONS`; approval and posting require `SUPER_ADMIN`. Provider- and bank-specific parsers are intentionally not supplied until their documented formats and sanitized samples are available. These workflows do not release merchant funds.

### Application Diagnostic

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/v1/test` | Public | Returns a basic API-running message; this is not a dependency readiness check. |

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

# PostgreSQL ledger, settlement, and NOWPayments integration tests
npm run test:ledger:integration
```

The integration command requires a dedicated local PostgreSQL test database; do not point it at a development or production database. NOWPayments unit tests mock the external API, so passing tests do not establish live-provider readiness.

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
- [NOWPayments Adapter & FX](./docs/architecture/nowpaymentsAdapter.md)
- [API Reference](./docs/architecture/apiReference.md)
- [Auth Contract & Cookies](./docs/architecture/authContract.md)
- [Database Schema & Migrations](./docs/database/setup.md)
- [Ledger Module & Cutover Guide](./docs/architecture/ledgerModule.md)
- [Logging & Request Correlation](./docs/development/logging.md)
- [Development Workflow & Setup](./docs/development/setup.md)
- [Unit Testing Architecture](./docs/development/unitTesting.md)
- [Business Product Context](./docs/business/product-overview.md)
