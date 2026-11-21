# Solaris Architecture Overview

This document reflects the architecture currently implemented in the repository rather than a long-term idealized roadmap.

The implementation also contains granular API and module documentation under [docs/architecture](./). For endpoint-level contract details, see [apiReference.md](./apiReference.md) and the module guides for [authContract.md](./authContract.md), [adminModule.md](./adminModule.md), [merchantModule.md](./merchantModule.md), [transactionsModule.md](./transactionsModule.md), and [ledgerModule.md](./ledgerModule.md). Logging operations are documented in [development/logging.md](../development/logging.md).

## 1. Current system shape

Solaris is a modular monolith built with NestJS, TypeScript, PostgreSQL, and Prisma. Docker Compose also provisions Redis, but the current backend source does not use it.

```text
Merchant or admin client
        │
        ▼
Solaris API (/v1)
        │
        ├── auth
        │   ├── merchant-auth
        │   └── admin-auth
        ├── merchants
        ├── admin
        ├── transactions
        ├── payment-providers
        │   └── adapters/nowpayments
        ├── fx
        ├── config
        ├── provider-callbacks
        ├── settlements
        ├── ledger
        ├── storage
        ├── email
        └── arcjet
        │
        ▼
PostgreSQL + Prisma
        │
        └── Merchant, profile, document, review, payment, ledger, settlement, and callback data

Local development infrastructure:
- Redis via Docker Compose (currently not connected to application code)
- MinIO for uploaded KYC documents (Cloudflare R2 in production)
- SMTP server for email delivery
```

This architecture reflects the actual code in `src/app.module.ts` and the feature modules under `src/`.

Authentication code is grouped by principal: `src/auth/merchant-auth/` contains merchant authentication and its `jwt/` implementation, while `src/auth/admin-auth/` contains admin authentication, role authorization, and its own `jwt/` implementation. Both feature modules are registered independently. The physical folder layout does not change the `/v1/auth` and `/v1/admin-auth` route prefixes.

## 2. Implemented responsibilities

### Authentication, merchant, and onboarding domains

Authentication features are separated under `src/auth/merchant-auth/` and `src/auth/admin-auth/`. This is a source organization change only: merchant routes remain under `/v1/auth`, and admin routes remain under `/v1/admin-auth`. The `merchants` module handles:

- merchant profile creation and update
- submission validation and admin review transitions
- KYC document upload request generation and document status tracking

### Administration domain

The `auth/admin-auth` and `admin` modules handle:

- internal admin authentication
- role-based authorization
- review of merchant applications
- approval and rejection logic
- audit history for status transitions

### Payment domain

The `transactions`, `checkout`, `payment-providers`, `provider-callbacks`, `fx`, `ledger`, and `settlements` modules implement:

- payment transaction creation and lookup
- hosted checkout sessions
- idempotent transaction creation boundaries
- provider adapter registration with a test adapter and NOWPayments adapter
- signed provider callbacks and NOWPayments IPNs with guarded payment-state transitions
- MWK-to-price-currency conversion for crypto invoice creation
- immutable double-entry payment postings and fee snapshots in `ledger`
- provider-neutral statement import, matching, allocation, approval, and posting in `settlements`

These are implemented payment and settlement lifecycles, but neither establishes production readiness by itself. Provider- and bank-specific statement parsers are not included.

## 3. Provider abstraction

The provider layer is implemented through a registry and adapter contract:

- `src/payment-providers/contracts/payment-provider.interface.ts`
- `src/payment-providers/registry/payment-provider.registry.ts`
- `src/payment-providers/adapters/test-provider.adapter.ts`

The registry currently exposes `TEST` and `NOWPAYMENTS` adapters. The common adapter contract allows other providers to be added without changing the transaction service contract. Airtel Money and TNM Mpamba adapters are not implemented.

The NOWPayments adapter creates a provider payment for the configured price currency, persists crypto payment details and the FX quote snapshot, and returns address/amount instructions to checkout. Its IPN endpoint is `/v1/provider-callbacks/nowpayments`; the `x-nowpayments-sig` signature is verified before processing. A `finished` status transitions the attempt/transaction and posts the crypto ledger capture in the same Prisma transaction. Partial payments enter pending reconciliation. Refund IPNs received after success are retained for manual handling and do not automatically change the successful state or reverse the ledger. See [nowpaymentsAdapter.md](./nowpaymentsAdapter.md) for configuration and readiness details.

### Settlement reconciliation

The settlement module provides provider-neutral normalized import interfaces for provider settlement rows and bank statement rows, matching, allocation controls, and a role-gated approval/posting workflow. `OPERATIONS` can import and reconcile; `SUPER_ADMIN` can approve and post. The workflow does not release merchant funds. Provider and bank parsers, report columns, and reference conventions remain undefined until their documentation and sanitized samples are available.

## 4. Callback processing

Callback handling is implemented in `src/provider-callbacks/provider-callbacks.service.ts` and is designed to:

- verify HMAC signatures against the raw request body
- reject expired or invalid timestamps
- ignore duplicates when the final outcome is unchanged
- guard against stale or contradictory state changes with transactional updates

This protects the payment state from race conditions and duplicate callback payloads.

## 5. Ledger and financial cutover

The `ledger` module is called by payment creation and successful callback processing. Fee policies are resolved and snapshotted when a payment is created; only a valid successful callback creates a payment posting. The callback's payment, attempt, entries, ledger transaction, and balance projections commit or roll back together.

The V1 posting debits provider clearing and credits merchant pending settlement plus nonzero platform fee revenue. Provider clearing is a receivable, not proof of cash settlement. Historical backfill is controlled and dry-run by default. The legacy `MerchantLedger` is retained for reconciliation and is not imported as an opening balance. See [ledgerModule.md](./ledgerModule.md) for the account model, operational commands, backfill rules, and cutover limitations.

Provider-neutral settlement reconciliation and controlled posting are implemented separately from payment capture. Provider/bank-specific statement parsers, merchant fund release, withdrawals, refunds, available-balance operations, and public ledger APIs are not implemented.

## 6. Storage layer

The `storage` module uses AWS S3 SDK against MinIO locally or Cloudflare R2 in production:

- pre-signed upload URLs
- signed download URLs
- metadata inspection
- file-signature validation for PDF/JPEG/PNG uploads
- cleanup for rejected or invalid uploads

The actual document upload flow is implemented, but it remains a backend-only storage workflow. It is not yet a full user-facing file management UI.

## 7. Important limitations

The current repository does not yet implement:

- Airtel Money or TNM Mpamba adapters and bank/provider-specific statement parsers
- merchant fund release, withdrawals, refunds, and available-balance APIs
- automatic ledger reversal handling for external refunds or disputes
- live NOWPayments sandbox/production verification and public IPN reachability checks
- durable asynchronous worker infrastructure for unrelated retries and webhook delivery
- production deployment hardening or multi-service operations

NOWPayments FX quotes are cached in process memory. The default upstream (`open.er-api.com`) publishes daily, although the configured poll interval defaults to 15 seconds. The adapter's maximum quote age measures local fetch time and does not verify upstream publication age; this must be resolved before treating the quote as production-fresh.

The architecture is therefore current and valid for the implemented code, but it is not a complete production payment platform design document.

## 8. Design direction

The project is intentionally a modular monolith for now. It keeps separate business domains and allows later extraction if the operational need becomes real. The codebase already reflects this boundary-oriented structure without requiring distributed services today.