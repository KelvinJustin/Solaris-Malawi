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
- **Crypto-native NOWPayments:** Merchants can create crypto-denominated transactions with an exact asset/network and decimal amount. The backend passes that amount as NOWPayments `pay_amount`; its required USD price reference is informational and does not convert the payment or merchant balance to MWK. IPN success credits the merchant's original crypto asset/network. Live sandbox/production behavior still requires provider validation.
- **Persistence:** Relational modeling for merchants, payment lifecycle, versioned fee policies, and immutable double-entry payment postings via Prisma 7 & PostgreSQL.
- **Settlement Reconciliation:** Provider-neutral normalized provider and bank statement imports, payment matching, allocation, and approval/posting workflow. Provider- and bank-specific parsers remain integration points until real sanitized reports and documentation are available.

### Roadmap / Not Yet Implemented
- Live Airtel Money, TNM Mpamba, and bank adapters/parsers. Do not infer their report formats or reference conventions without provider/bank documentation and sanitized samples.
- Merchant fund release, withdrawals, refunds, reversals, available-balance operations, and public merchant balance APIs.
- Live NOWPayments sandbox/production verification and operational confirmation of public IPN reachability.

### V1 Ledger Foundation
Successful callbacks post balanced entries synchronously in the same PostgreSQL transaction as payment and attempt state changes. MWK payment creation stores an immutable fee snapshot using the active merchant override or platform default; the migration seeds a ZERO/MWK platform policy. Crypto payments use their separate crypto fee setting and native-asset ledger instead of an MWK fee snapshot. Provider-clearing accounts represent receivables, not settled cash. Legacy `MerchantLedger` balances are reported for reconciliation only and are never converted into opening balances.

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

The NOWPayments adapter is registered alongside the test adapter. Merchants create a crypto transaction with a decimal-string amount and the supported asset/network; checkout initiation uses the saved pair and exact amount without asking for another ticker. NOWPayments requires a fiat `price_amount` even when `pay_amount` is supplied, so the adapter obtains a USD reference estimate from NOWPayments. The exact crypto amount is sent as `pay_amount`, and the reference estimate does not change payment denomination or ledger credit. The backend also logs availability by calling NOWPayments' public `/v1/status` endpoint at startup and every 60 seconds. The public IPN route is `/v1/provider-callbacks/nowpayments`; callbacks require a valid `x-nowpayments-sig` signature. Stale in-flight payments are reconciled by polling NOWPayments while the API key is configured. A `finished` result posts the crypto ledger capture atomically. `NOWPAYMENTS_FEE_BPS` defaults to `0`. Partial payments enter pending reconciliation. A refund IPN received after success is retained for manual handling; it does not change the successful state or automatically reverse the ledger. See [NOWPayments integration](docs/architecture/nowpaymentsIntegration.md) for request/response details.

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
  ├── config/               # Namespaced NOWPayments configuration
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
| `config` | Namespaced NOWPayments adapter configuration. |
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

For NOWPayments, configure `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `NOWPAYMENTS_BASE_URL`, and `PUBLIC_API_BASE_URL`. The public API URL must use reachable HTTPS for sandbox IPNs as well as production. `NOWPAYMENTS_FEE_BPS` sets the approved crypto fee in basis points and defaults to `0`. The adapter obtains NOWPayments' required USD `price_amount` reference from its estimate API; it sends the exact merchant-entered crypto amount separately as `pay_amount`. This reference does not convert the payment or merchant balance to MWK. Never commit actual credentials.

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
`npm start` and `npm run start:prod` apply pending Prisma migrations before starting the API. They require `DATABASE_URL` to point to the intended database. The API will be available at `http://localhost:3000` with all routes prefixed with `/v1`. `npm run start:dev` does not apply migrations; apply them manually before using development mode.

### Logging

The backend uses Pino for structured NestJS and HTTP logs. Logs are written as JSON to stdout and to rotating files under `backend/logs` by default. Docker Compose mounts this directory so log files survive container recreation. Configure `LOG_LEVEL` (`info` by default) and `LOG_DIR` (`logs` by default) in the environment. Files rotate daily or at 20 MiB, with up to 14 rotated files retained. HTTP logs use route templates and omit credentials, cookies, and raw checkout tokens.

---

## API Catalog

All backend routes are versioned under `/v1`. The [Bruno API Collection](./api-collections/solaris/README.md) contains request and response templates for the routes below, including both MWK and crypto checkout variants. See the [API Reference](./docs/architecture/apiReference.md) for the consolidated contract.

### Merchant Authentication (`/v1/auth`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/auth/register` | Public | Register a merchant with email, password, name, and phone. |
| `POST` | `/v1/auth/verify-email` | Public | Verify registration OTP sent via email. |
| `POST` | `/v1/auth/resend-verification` | Public | Request another email-verification code. |
| `POST` | `/v1/auth/login` | Public | Check credentials and send a login OTP. |
| `POST` | `/v1/auth/verify-login` | Public | Validate login OTP and set the HTTP-only `access_token` cookie. |
| `GET` | `/v1/auth/me` | Merchant cookie | Return current merchant identity. |
| `POST` | `/v1/auth/logout` | Merchant cookie | Revoke the current JWT and clear the cookie. |
| `DELETE` | `/v1/auth/account` | Merchant cookie | Soft-delete the authenticated merchant account. |

### Merchant Profile & KYC (`/v1/merchants`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/v1/merchants/profile` | Merchant cookie | Return profile and document metadata. |
| `PATCH` | `/v1/merchants/profile` | Merchant cookie | Update editable profile fields. |
| `POST` | `/v1/merchants/profile/submit` | Merchant cookie | Submit the profile and required documents for review. |
| `POST` | `/v1/merchants/documents/upload-url` | Merchant cookie | Create a signed upload URL and upload intent. |
| `PUT` | `{{uploadUrl}}` | Presigned URL | Upload document bytes directly to object storage; not a `/v1` backend route. |
| `POST` | `/v1/merchants/documents/:uploadId/complete` | Merchant cookie | Validate and finalize the uploaded file. |
| `GET` | `/v1/merchants/documents` | Merchant cookie | List document metadata and assessment states. |

### Admin & Compliance (`/v1/admin` & `/v1/admin-auth`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/admin-auth/login` | Public | Admin login; sets the HTTP-only `admin_access_token` cookie. |
| `POST` | `/v1/admin-auth/logout` | Admin cookie | Revoke the admin session and clear its cookie. |
| `GET` | `/v1/admin-auth/me` | Admin cookie | Return current admin identity and role. |
| `GET` | `/v1/admin/merchant-applications` | `SUPER_ADMIN` or `COMPLIANCE` | List paginated submitted and in-review applications. |
| `GET` | `/v1/admin/merchant-applications/:profileId` | `SUPER_ADMIN` or `COMPLIANCE` | Return profile, merchant, documents, and review history. |
| `POST` | `/v1/admin/merchant-applications/:profileId/start-review` | `SUPER_ADMIN` or `COMPLIANCE` | Move a submitted application into `UNDER_REVIEW`. |
| `POST` | `/v1/admin/merchant-applications/:profileId/approve` | `SUPER_ADMIN` or `COMPLIANCE` | Approve an in-review application after document checks. |
| `POST` | `/v1/admin/merchant-applications/:profileId/reject` | `SUPER_ADMIN` or `COMPLIANCE` | Reject an in-review application with a reason. |
| `GET` | `/v1/admin/merchant-applications/:profileId/documents/:documentId/preview` | `SUPER_ADMIN` or `COMPLIANCE` | Generate a time-limited document preview URL. |

### Transactions & Checkout (`/v1/transactions` & `/v1/checkout`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/transactions` | Merchant cookie | Create an MWK or crypto transaction; requires `Idempotency-Key`. |
| `GET` | `/v1/transactions/:reference` | Merchant cookie | Return the merchant's transaction summary and status. |
| `GET` | `/v1/checkout/:token` | Public | Validate a hosted checkout link and return payment details. |
| `POST` | `/v1/checkout/:token/pay` | Public + Arcjet | Initiate mobile-money or NOWPayments payment for the saved transaction. |
| `POST` | `/v1/provider-callbacks` | Signed callback | Verify and process the generic signed provider callback. |
| `POST` | `/v1/provider-callbacks/nowpayments` | NOWPayments IPN signature | Verify `x-nowpayments-sig` and process NOWPayments payment status. |

Create a crypto-denominated transaction by sending `paymentType: "CRYPTO"`, `provider: "NOWPAYMENTS"`, `asset`, `network`, and a positive decimal-string `amount` to `POST /v1/transactions`. The selected denomination and amount are persisted with that transaction. Checkout then calls `POST /v1/checkout/:token/pay` with `{ "provider": "NOWPAYMENTS" }` only; it must not choose a replacement ticker, network, or amount. When provider payment creation succeeds, the response includes `payment_instructions` with `paymentAddress`, `payAmount`, `asset`, `network`, and `expiresAt`. Provider rejection or an uncertain result has no payment instructions; the final payment outcome is delivered through the signed NOWPayments IPN. See [NOWPayments Crypto Integration](./docs/architecture/nowpaymentsIntegration.md) for request/response examples and status behavior.

### Settlement Operations (`/v1/admin/settlements`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/admin/settlements/provider-imports/normalized` | `OPERATIONS` | Import a normalized provider settlement report. |
| `POST` | `/v1/admin/settlements/bank-statements/normalized` | `OPERATIONS` | Import normalized bank statement lines. |
| `POST` | `/v1/admin/settlements/:batchId/reconcile` | `OPERATIONS` | Match provider settlement items to payment records. |
| `POST` | `/v1/admin/settlements/allocations` | `OPERATIONS` | Allocate a bank credit to a settlement batch. |
| `POST` | `/v1/admin/settlements/:batchId/approve` | `SUPER_ADMIN` | Approve a reconciled and fully allocated batch. |
| `POST` | `/v1/admin/settlements/:batchId/post` | `SUPER_ADMIN` | Post an approved batch to the ledger. |

Provider- and bank-specific parsers are not included until their documented formats and sanitized samples are available. These workflows do not release merchant funds. Settlement handlers currently return Prisma records with raw JavaScript `BigInt` amounts and no BigInt-to-JSON serializer is configured; response serialization may fail until those values are converted.

### Application Diagnostic

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/v1/test` | Public | Returns a basic API-running message; this is not a dependency readiness check. |

For detailed request/response examples, open the [Bruno API Collection guide](./api-collections/solaris/README.md). Further implementation details are linked below.

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
- [Bruno API Collection and endpoint examples](./api-collections/solaris/README.md)
- [Consolidated API Reference](./docs/architecture/apiReference.md)
- [Architecture Overview](./docs/architecture/overview.md)
- [NOWPayments Crypto Integration](./docs/architecture/nowpaymentsIntegration.md)
- [NOWPayments Adapter](./docs/architecture/nowpaymentsAdapter.md)
- [Auth Contract & Cookies](./docs/architecture/authContract.md)
- [Admin Authentication Module](./docs/architecture/AdminAuthModule.md)
- [Merchant Module](./docs/architecture/merchantModule.md)
- [Admin Module](./docs/architecture/adminModule.md)
- [Transactions Module](./docs/architecture/transactionsModule.md)
- [Storage Module](./docs/architecture/storageModule.md)
- [Database Schema & Migrations](./docs/database/setup.md)
- [Ledger Module & Cutover Guide](./docs/architecture/ledgerModule.md)
- [Logging & Request Correlation](./docs/development/logging.md)
- [Development Workflow & Setup](./docs/development/setup.md)
- [Unit Testing Architecture](./docs/development/unitTesting.md)
- [Business Product Context](./docs/business/product-overview.md)
