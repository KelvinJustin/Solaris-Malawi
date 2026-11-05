<p align="center">
  <img src="assets/logo.png" alt="Solaris Malawi" width="500">
</p>

# Solaris Malawi

Solaris Malawi is a NestJS-based payment gateway backend for the Malawian digital economy. It currently implements merchant onboarding, administrative review, and the start of a payment lifecycle with hosted checkout, provider initiation, callback verification, and transaction persistence.

This repository is not yet a complete production payment platform, but it does contain implemented backend flows beyond the original foundational onboarding work.

## Current status

The codebase currently supports:

- Merchant registration and verification using email OTPs
- Merchant login, logout, and JWT session handling
- Business profile creation, validation, and resubmission
- KYC document upload requests and signed storage URLs via Cloudflare R2
- Merchant application review by administrator roles
- Hosted checkout sessions and transaction creation with idempotency
- Provider initiation through a provider registry and test adapter
- Signed provider callback handling and payment state changes
- Transaction and payment-attempt persistence in PostgreSQL

Important limitations remain:

- No production payment provider integrations (Airtel Money, TNM Mpamba, or bank integrations) are implemented yet
- The test provider adapter is explicitly for local or simulator use only
- There is no production settlement, ledger posting, or withdrawal workflow beyond schema placeholders
- The project is still a modular monolith and not yet a fully hardened production deployment

## Architecture

Solaris is a modular monolith structured as NestJS feature modules running in a single backend.

```text
Clients
  │
  ▼
Solaris API (/v1)
  │
  ├── auth
  ├── merchants
  ├── admin-auth
  ├── admin
  ├── transactions
  ├── payment-providers
  ├── provider-callbacks
  ├── storage
  ├── email
  └── arcjet
  │
  ▼
PostgreSQL + Prisma
  │
  └── Transaction / merchant / onboarding / review data

Additional local infrastructure:
- Redis via Docker Compose
- Cloudflare R2 for KYC document storage
- SMTP for email delivery
```

### Module responsibilities

| Module | Responsibility |
|---|---|
| `auth` | Merchant registration, OTP verification, login, logout, JWT token handling |
| `merchants` | Merchant profile lifecycle, KYC requirements, document upload flow, submission rules |
| `admin-auth` | Admin login and auth cookie handling |
| `admin` | Merchant application review, approval, and rejection |
| `transactions` | Payment transaction creation, hosted-checkout validation, initiation, and lookup |
| `payment-providers` | Provider registry and adapter implementations |
| `provider-callbacks` | Signed callback validation and payment-status updates |
| `storage` | Cloudflare R2 upload/download helpers |
| `email` | SMTP notifications |
| `arcjet` | Request protection and rate limiting |
| `database` | Prisma client configuration and DB connectivity checks |

## Technology stack

- TypeScript
- NestJS 12
- Node.js 24
- PostgreSQL
- Prisma 7
- Redis
- Docker Compose
- Vitest
- Arcjet
- Cloudflare R2 (S3-compatible)
- Nodemailer

## Local setup

### Prerequisites

- Node.js 24+
- npm
- Git
- Docker + Docker Compose
- A PostgreSQL instance reachable through `DATABASE_URL`

### Install

```bash
git clone https://github.com/KelvinJustin/Solaris-Malawi.git
cd Solaris-Malawi
npm install
```

### Environment configuration

Copy the example file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

The project expects values such as:

- `DATABASE_URL`
- `JWT_SECRET`
- `OTP_SECRET`
- `ENCRYPTION_SALT`
- `SMTP_SERVER`, `SMTP_PORT`, `SMTP_USER`, `SMTP_API_KEY`, `SMTP_FROM`
- `ARCJET_KEY`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- `CHECKOUT_TOKEN_ENCRYPTION_KEY`
- `CHECKOUT_BASE_URL`
- `TEST_PROVIDER_BASE_URL`
- `SIGNING_SECRET`
- `PORT`, `NODE_ENV`

The local Compose stack does not provision PostgreSQL. The app relies on the configured `DATABASE_URL` for the database connection.

### Run the app

Generate Prisma client and apply migrations if needed:

```bash
npx prisma generate
npx prisma migrate deploy
npm run start:dev
```

The API listens on the configured port (default: `3000`) with `/v1` routes.

### Run with Docker

```bash
docker compose up --build
```

The Compose file starts the API and Redis only. Redis is exposed on `6379`; the app still requires a reachable PostgreSQL instance through `DATABASE_URL`.

## API summary

All current backend routes are under `/v1`.

### Merchant auth

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/v1/auth/register` | Register a merchant and send a verification email |
| `POST` | `/v1/auth/login` | Start merchant login with email/password |
| `POST` | `/v1/auth/verify-email` | Verify registration OTP |
| `POST` | `/v1/auth/verify-login` | Complete 2FA login |
| `GET` | `/v1/auth/me` | Fetch current authenticated merchant |
| `POST` | `/v1/auth/logout` | Log out the current merchant |

### Merchant profiles and documents

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/v1/merchants/profile` | Return the merchant profile |
| `PATCH` | `/v1/merchants/profile` | Update editable profile fields |
| `POST` | `/v1/merchants/profile/submit` | Submit for admin review |
| `POST` | `/v1/merchants/documents/upload-url` | Request a signed file upload URL |
| `POST` | `/v1/merchants/documents/:uploadId/complete` | Finalize a document upload |
| `GET` | `/v1/merchants/documents` | List merchant documents |

### Admin auth and review

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/v1/admin-auth/login` | Admin login |
| `POST` | `/v1/admin-auth/logout` | Admin logout |
| `GET` | `/v1/admin-auth/me` | Current admin profile |
| `GET` | `/v1/admin/merchant-applications` | Paginated merchant applications |
| `GET` | `/v1/admin/merchant-applications/:profileId` | Single application detail |
| `POST` | `/v1/admin/merchant-applications/:profileId/start-review` | Move to review |
| `POST` | `/v1/admin/merchant-applications/:profileId/approve` | Approve an application |
| `POST` | `/v1/admin/merchant-applications/:profileId/reject` | Reject an application with a reason |

### Transactions and hosted checkout

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/v1/transactions` | Create a merchant payment transaction |
| `GET` | `/v1/transactions/:reference` | Fetch a transaction by public reference |
| `GET` | `/v1/checkout/:token` | Validate a checkout session |
| `POST` | `/v1/checkout/:token/pay` | Start payment initiation for an active checkout session |
| `POST` | `/v1/provider-callbacks` | Receive signed provider status callbacks |

## Key data model shapes

The schema covers merchant identity, onboarding, docs, administrative workflow, and payment lifecycle state.

| Model | Purpose |
|---|---|
| `Merchant` | Merchant account |
| `MerchantProfile` | Business profile and onboarding state |
| `MerchantDocument` | KYC document metadata and review state |
| `MerchantReviewHistory` | Review audit trail |
| `Admin` | Internal admin accounts and roles |
| `OtpChallenge` | Merchant OTP challenge data |
| `PaymentTransaction` | Merchant payment record |
| `PaymentAttempt` | Individual provider attempt history |
| `CheckoutSession` | Public hosted-checkout token/session |
| `RevokedToken` / `AdminRevokedToken` | JWT revocation records |

## Payment flow status

The repository already contains a concrete payment flow for a hosted checkout:

1. A merchant creates a transaction with an idempotency key.
2. A checkout session and public reference are generated.
3. The customer visits the hosted checkout URL.
4. The checkout session is validated and can be paid only while active.
5. A provider is selected and a payment attempt is started.
6. The provider adapter returns ACCEPTED, REJECTED, or UNKNOWN.
7. A callback can complete or fail the payment, with signature verification and duplicate protection.

This is an implemented backend flow, but it is not yet a full production settlement system.

## Security notes

The current backend includes:

- bcrypt password hashing
- HMAC-based OTP storage
- JWT auth and revocation checks
- admin role-based access control
- HTTP-only auth cookies
- signed provider callback verification using `SIGNING_SECRET`
- explicit checks to guard against duplicate or stale callback and transaction races

These checks are real implementation details, but they do not make the platform production-complete on their own.

## Testing

The repository uses Vitest and includes test coverage for authentication, merchant workflows, admin workflows, transactions, storage, callbacks, and supporting services.

Typical commands:

```bash
npm run test
npm run test:watch
npm run test:cov
npm run test:e2e
npm run build
```

The project still needs broader integration testing for real database behavior, provider interactions, and production-like failure paths.

## Documentation map

- [docs/architecture/overview.md](./docs/architecture/overview.md) — current architecture notes
- [docs/development/setup.md](./docs/development/setup.md) — local dev setup
- [docs/database/setup.md](./docs/database/setup.md) — Prisma/PostgreSQL usage
- [docs/business/product-overview.md](./docs/business/product-overview.md) — business/product context

## License

This repository is marked `UNLICENSED` in `package.json`.