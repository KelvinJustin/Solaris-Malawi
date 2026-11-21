# Solaris API Reference

This document is the central endpoint index for the current backend implementation. Every route is versioned under `/v1` and the app is configured with URI versioning, so requests use paths such as `/v1/auth/login` rather than `/auth/login`.

Unless a route is explicitly public, a valid authentication cookie or JWT-bearing `Authorization` header is required. Merchant auth is issued in the `access_token` cookie; admin auth uses the `admin_access_token` cookie.

## 1. Route index

| Module | Method | Endpoint | Auth | Request contract | Primary response |
|---|---|---|---|---|---|
| App | `GET` | `/v1/test` | Public | none | simple API-running message; not a dependency readiness check |
| Auth | `POST` | `/v1/auth/register` | Public | `name`, `email`, `password`, `phone` | `201` with verification email status |
| Auth | `POST` | `/v1/auth/login` | Public | `email`, `password` | `201` with OTP email status |
| Auth | `POST` | `/v1/auth/verify-login` | Public | `email`, `code` | sets `access_token` cookie, returns redirect payload |
| Auth | `POST` | `/v1/auth/verify-email` | Public | `email`, `code` | sets `access_token` cookie, returns success message |
| Auth | `POST` | `/v1/auth/resend-verification` | Public | `email` | generic success message |
| Auth | `GET` | `/v1/auth/me` | Required | none | current merchant identity |
| Auth | `POST` | `/v1/auth/logout` | Required | none | clears cookie, returns success message |
| Auth | `DELETE` | `/v1/auth/account` | Required | none | soft-deletes the merchant account |
| Admin auth | `POST` | `/v1/admin-auth/login` | Public | `email`, `password` | sets `admin_access_token` cookie |
| Admin auth | `POST` | `/v1/admin-auth/logout` | Required | none | clears admin cookie, revokes token |
| Admin auth | `GET` | `/v1/admin-auth/me` | Required | none | current admin identity |
| Admin | `GET` | `/v1/admin/merchant-applications` | Required + role | `page`, `limit` query params | paginated applications |
| Admin | `GET` | `/v1/admin/merchant-applications/:profileId` | Required + role | path param `profileId` | single application |
| Admin | `POST` | `/v1/admin/merchant-applications/:profileId/start-review` | Required + role | path param `profileId` | review started payload |
| Admin | `POST` | `/v1/admin/merchant-applications/:profileId/approve` | Required + role | path param `profileId` | approval result |
| Admin | `POST` | `/v1/admin/merchant-applications/:profileId/reject` | Required + role | path param `profileId`, JSON `reason` | rejection result |
| Admin | `GET` | `/v1/admin/merchant-applications/:profileId/documents/:documentId/preview` | Required + role | path params `profileId`, `documentId` | signed preview URL |
| Merchants | `GET` | `/v1/merchants/profile` | Required | none | current merchant profile |
| Merchants | `PATCH` | `/v1/merchants/profile` | Required | partial `CreateProfileDto` data | updated profile |
| Merchants | `POST` | `/v1/merchants/profile/submit` | Required | none | submits for review |
| Merchants | `POST` | `/v1/merchants/documents/upload-url` | Required | JSON `type`, `contentType` | signed upload URL |
| Merchants | `POST` | `/v1/merchants/documents/:uploadId/complete` | Required | path param `uploadId` | finalize document upload |
| Merchants | `GET` | `/v1/merchants/documents` | Required | none | document list |
| Transactions | `POST` | `/v1/transactions` | Required | `amountTambala`, optional `customerPhone`, `description`, `merchantReference` | payment session creation |
| Transactions | `GET` | `/v1/transactions/:reference` | Required | path param `reference` | transaction details |
| Checkout | `GET` | `/v1/checkout/:token` | Public | path param `token` | public checkout session metadata |
| Checkout | `POST` | `/v1/checkout/:token/pay` | Public | Mobile money: `provider`, `phoneNumber`; NOWPayments: `provider`, `payCurrency`, optional `network` | provider payment initiation; crypto success includes payment instructions |
| Provider callbacks | `POST` | `/v1/provider-callbacks` | Public, signed | raw JSON body + callback headers | callback acknowledgement |
| NOWPayments | `POST` | `/v1/provider-callbacks/nowpayments` | Public, signed | NOWPayments IPN body + `x-nowpayments-sig` | IPN acknowledgement |
| Settlements | `POST` | `/v1/admin/settlements/provider-imports/normalized` | Admin `OPERATIONS` | normalized provider batch | imported batch |
| Settlements | `POST` | `/v1/admin/settlements/bank-statements/normalized` | Admin `OPERATIONS` | normalized bank statement | imported statement |
| Settlements | `POST` | `/v1/admin/settlements/:batchId/reconcile` | Admin `OPERATIONS` | batch identifier | reconciliation result |
| Settlements | `POST` | `/v1/admin/settlements/allocations` | Admin `OPERATIONS` | allocation request | allocation result |
| Settlements | `POST` | `/v1/admin/settlements/:batchId/approve` | Admin `SUPER_ADMIN` | batch identifier | approval result |
| Settlements | `POST` | `/v1/admin/settlements/:batchId/post` | Admin `SUPER_ADMIN` | batch identifier | posting result |

## 2. Related documents

- [authContract.md](./authContract.md)
- [AdminAuthModule.md](./AdminAuthModule.md)
- [adminModule.md](./adminModule.md)
- [merchantModule.md](./merchantModule.md)
- [transactionsModule.md](./transactionsModule.md)
- [nowpaymentsAdapter.md](./nowpaymentsAdapter.md)
- [overview.md](./overview.md)

## 3. API conventions

- JSON payloads are validated by NestJS `ValidationPipe` with `whitelist` and `forbidNonWhitelisted` enabled.
- Request bodies must match the DTO field names exactly.
- Provider callback endpoints have provider-specific signature contracts. The generic provider callback verifies its raw-body signature; NOWPayments verifies its `x-nowpayments-sig` IPN signature before processing the payload.
- Public checkout links are short-lived and expire after 30 minutes by default.
- Amounts in payment APIs are expressed in tambala for internal storage, while provider callbacks send `MWK` values in decimal form and are converted to tambala before validation.

## 4. Notes for frontend and integration clients

- Always include `credentials: 'include'` when using cookie-based auth endpoints.
- All auth cookies are `HttpOnly` and should not be read from JavaScript.
- The transaction creation flow is idempotent only when the same `Idempotency-Key` header is reused with identical payload data.
- Callback providers must send `x-provider-timestamp` and `x-provider-signature`; the server rejects stale or invalid signatures.
- NOWPayments checkout requires a `payCurrency`; accepted initiation returns payment instructions but does not mean payment has completed. See [nowpaymentsAdapter.md](./nowpaymentsAdapter.md) for the IPN lifecycle and readiness limits.
- Settlement import/reconciliation endpoints accept normalized data only. Provider- and bank-specific parsers are not included until documented formats and sanitized samples are available. Operations users import/reconcile/allocate; super admins approve/post.
