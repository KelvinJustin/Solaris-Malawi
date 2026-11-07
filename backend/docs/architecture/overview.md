# Solaris Architecture Overview

This document reflects the architecture currently implemented in the repository rather than a long-term idealized roadmap.

The implementation also contains granular API documentation under [docs/architecture](./). For endpoint-level contract details, see [apiReference.md](./apiReference.md) and the module guides for [authContract.md](./authContract.md), [adminModule.md](./adminModule.md), [merchantModule.md](./merchantModule.md), and [transactionsModule.md](./transactionsModule.md).

## 1. Current system shape

Solaris is a modular monolith built with NestJS, TypeScript, PostgreSQL, Prisma, and Redis. The backend is organized around feature modules instead of independent services.

```text
Merchant or admin client
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
        └── Merchant, profile, document, review, payment, and callback data

Local development infrastructure:
- Redis via Docker Compose
- Cloudflare R2 for uploaded KYC documents
- SMTP server for email delivery
```

This architecture reflects the actual code in `src/app.module.ts` and the feature modules under `src/`.

## 2. Implemented responsibilities

### Merchant and onboarding domain

The `auth` and `merchants` modules handle:

- merchant registration
- email verification OTPs
- password-based login and 2FA login verification
- JWT authentication and explicit revocation
- merchant profile creation and update
- submission validation and admin review transitions
- KYC document upload request generation and document status tracking

### Administration domain

The `admin-auth` and `admin` modules handle:

- internal admin authentication
- role-based authorization
- review of merchant applications
- approval and rejection logic
- audit history for status transitions

### Payment domain

The `transactions`, `checkout`, `payment-providers`, and `provider-callbacks` modules implement:

- payment transaction creation and lookup
- hosted checkout sessions
- idempotent transaction creation boundaries
- provider adapter registration
- a simulator provider for local testing
- signed callback verification and payment-state transitions

This is more than a placeholder. It is an implemented payment lifecycle, but it is intentionally scoped and not a complete production settlement system.

## 3. Provider abstraction

The provider layer is implemented through a registry and adapter contract:

- `src/payment-providers/contracts/payment-provider.interface.ts`
- `src/payment-providers/registry/payment-provider.registry.ts`
- `src/payment-providers/adapters/test-provider.adapter.ts`

The current implementation exposes a single `TEST` provider adapter and is designed so additional provider adapters can be added without changing the transaction service contract.

## 4. Callback processing

Callback handling is implemented in `src/provider-callbacks/provider-callbacks.service.ts` and is designed to:

- verify HMAC signatures against the raw request body
- reject expired or invalid timestamps
- ignore duplicates when the final outcome is unchanged
- guard against stale or contradictory state changes with transactional updates

This protects the payment state from race conditions and duplicate callback payloads.

## 5. Storage layer

The `storage` module integrates with Cloudflare R2 using the AWS S3 SDK:

- pre-signed upload URLs
- signed download URLs
- metadata inspection
- file-signature validation for PDF/JPEG/PNG uploads
- cleanup for rejected or invalid uploads

The actual document upload flow is implemented, but it remains a backend-only storage workflow. It is not yet a full user-facing file management UI.

## 6. Important limitations

The current repository does not yet implement:

- Airtel Money or TNM Mpamba production adapters
- settlement or withdrawal workflows
- double-entry ledger posting
- routine payment reconciliation jobs
- durable asynchronous worker infrastructure for retries and webhooks
- production deployment hardening or multi-service operations

The architecture is therefore current and valid for the implemented code, but it is not a complete production payment platform design document.

## 7. Design direction

The project is intentionally a modular monolith for now. It keeps separate business domains and allows later extraction if the operational need becomes real. The codebase already reflects this boundary-oriented structure without requiring distributed services today.