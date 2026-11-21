# Solaris Malawi — Payment, Checkout, and Provider Callback API

## 1. Overview

The payment domain is implemented in the `transactions`, `checkout`, and `provider-callbacks` routes.

It covers:

- merchant-initiated payment transaction creation
- public hosted checkout sessions
- provider payment initiation from the checkout page
- signed generic provider callback and NOWPayments IPN verification
- state transitions for payment attempts and transactions
- payment capture posting through the ledger

All routes are under the backend URI version prefix `/v1`.

## 2. Authentication and access rules

### Merchant transactions

Routes in `src/transactions/transactions.controller.ts` are protected by `JwtAuthGuard` and therefore require a valid merchant JWT cookie.

### Public checkout endpoints

The checkout routes in `src/transactions/checkout.controller.ts` are intentionally public. They validate the checkout token, not the caller's identity.

### Callback endpoint

`POST /v1/provider-callbacks` is public (JWT-free), but each request must include a timestamp and HMAC signature that matches the raw request body. NOWPayments uses its separate signature-verified IPN route described in the integration guide.

## 3. Merchant transaction creation

### 3.1 Create a payment transaction

**Endpoint**

`POST /v1/transactions`

**Authentication**

Required (`access_token` cookie or equivalent JWT bearer token).

**Headers**

| Header | Required | Description |
|---|---|---|
| `Idempotency-Key` | Yes | Unique key used to prevent duplicate payment creation across retries. |
| `Content-Type` | Yes | `application/json` |

**Request body**

MWK payments use the existing tambala input:

```json
{
  "amountTambala": 2500,
  "customerPhone": "+265991234567",
  "description": "Order #123",
  "merchantReference": "INV-123"
}
```

Crypto payments use a separate request shape:

```json
{
  "paymentType": "CRYPTO",
  "provider": "NOWPAYMENTS",
  "asset": "USDT",
  "network": "TRC20",
  "amount": "25.75",
  "description": "Order INV-2048",
  "merchantReference": "INV-2048"
}
```

**Field rules**

| Field | Type | Required | Rules |
|---|---|---|---|
| `paymentType` | string | No | `MWK` or `CRYPTO`; omitted defaults to MWK. |
| `amountTambala` | integer | MWK | Must be an integer greater than or equal to 1 and not exceed `2_147_483_647`. |
| `provider` | string | Crypto | Must be `NOWPAYMENTS`. |
| `asset` | string | Crypto | Must be a supported asset/network pair. |
| `network` | string or null | Crypto | Native assets use `null` or omit this field. |
| `amount` | decimal string | Crypto | Positive; up to 18 integer and 18 fractional digits. |
| `customerPhone` | string | No | If provided, must be a valid Malawian phone number. |
| `description` | string | No | Maximum 255 characters. |
| `merchantReference` | string | No | Maximum 100 characters. |

**Permission rule**

The merchant's profile must be `APPROVED` before a transaction can be created. If the profile is not approved, the server returns `403 Forbidden`.

**Example success response — `201 Created` (TEST provider)**

```json
{
  "publicReference": "sp_9d1a3f5e4c214d82a8d9f4bdff9e0e6d",
  "status": "CREATED",
  "amountTambala": 2500,
  "currency": "MWK",
  "checkout_url": "https://checkout.example.com/checkout/abc123",
  "expires_at": "2026-11-07T12:30:00.000Z"
}
```

**Notes**

- `publicReference` is a public, merchant-facing reference and is not the database UUID.
- `checkout_url` is generated from `CHECKOUT_BASE_URL` and points to the hosted checkout page.
- Crypto creation returns `paymentType`, `provider`, `asset`, `network`, and normalized decimal-string `amount` instead of `amountTambala`/`currency`.
- Reusing the same `Idempotency-Key` with identical payload data returns the same checkout result instead of creating a new transaction.
- Reusing the same `Idempotency-Key` with different payment data results in `409 Conflict`.
- Crypto requests do not create an MWK fee snapshot. NOWPayments' required USD `price_amount` is a provider-only reference; the exact crypto input is submitted as `pay_amount`.

### 3.2 Get a merchant transaction

**Endpoint**

`GET /v1/transactions/:reference`

**Authentication**

Required.

**Path parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `reference` | string | Yes | The transaction `publicReference` (for example `sp_...`) |

**Success response — `200 OK`**

The response is shaped by payment type. An MWK response is:

```json
{
  "publicReference": "sp_9d1a3f5e4c214d82a8d9f4bdff9e0e6d",
  "amountTambala": 2500,
  "currency": "MWK",
  "status": "PROCESSING",
  "provider": "TEST",
  "description": "Order #123",
  "merchantReference": "INV-123",
  "createdAt": "2026-11-07T12:15:00.000Z",
  "processedAt": null
}
```

For crypto, the financial fields are `paymentType`, `asset`, `network`, and `amount`:

```json
{
  "publicReference": "sp_9d1a3f5e4c214d82a8d9f4bdff9e0e6d",
  "paymentType": "CRYPTO",
  "provider": "NOWPAYMENTS",
  "asset": "USDT",
  "network": "TRC20",
  "amount": "25.75",
  "status": "PROCESSING",
  "description": "Order INV-2048",
  "merchantReference": "INV-2048",
  "createdAt": "2026-11-07T12:15:00.000Z",
  "processedAt": null
}
```

**Failure**

- `404 Not Found` if the transaction does not belong to the authenticated merchant.

## 4. Hosted checkout flow

### 4.1 Open a checkout session

**Endpoint**

`GET /v1/checkout/:token`

**Authentication**

None.

**Path parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `token` | string | Yes | Public checkout token generated during transaction creation. |

**Success response — `200 OK`**

For a crypto transaction:

```json
{
  "reference": "sp_9d1a3f5e4c214d82a8d9f4bdff9e0e6d",
  "status": "CREATED",
  "paymentType": "CRYPTO",
  "provider": "NOWPAYMENTS",
  "asset": "USDT",
  "network": "TRC20",
  "amount": "25.75",
  "description": "Order INV-2048",
  "canPay": true
}
```

For comparison, MWK checkout continues to return `amountTambala` and `currency`:

```json
{
  "reference": "sp_9d1a3f5e4c214d82a8d9f4bdff9e0e6d",
  "amountTambala": 2500,
  "currency": "MWK",
  "description": "Order #123",
  "status": "CREATED",
  "canPay": true
}
```

**Behavior**

- The server hashes the token and looks up the matching active checkout session.
- If the token is missing, expired, or already consumed, the API returns `404` with a generic invalid-link message.
- `canPay` is only `true` when the transaction is still in `CREATED` state.

### 4.2 Initiate a payment from checkout

**Endpoint**

`POST /v1/checkout/:token/pay`

**Authentication**

None.

**Path parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `token` | string | Yes | Active checkout session token from the hosted checkout page. |

**Request body**

```json
{
  "provider": "TEST",
  "phoneNumber": "+265991234567"
}
```

**Field rules**

| Field | Type | Required | Rules |
|---|---|---|---|
| `provider` | string | Yes | Registered choices are `TEST` and `NOWPAYMENTS`. `AIRTEL_MONEY` and `TN_MPAMBA` exist in the enum but have no registered adapters yet. |
| `phoneNumber` | string | Mobile money / test | Must be a valid Malawian phone number when required by the selected adapter. |
| Crypto denomination | — | NOWPayments | Asset, network, and amount are fixed at transaction creation; initiation accepts no replacement values. |

For NOWPayments, omit `phoneNumber` and send only:

```json
{
  "provider": "NOWPAYMENTS"
}
```

An accepted crypto initiation returns `payment_instructions` with the payment address, pay amount, asset, network, and expiry. `PROCESSING` means the provider invoice/payment flow is active, not that funds are received. The actual result arrives through `POST /v1/provider-callbacks/nowpayments`.

**Success response — `201 Created`**

```json
{
  "reference": "sp_9d1a3f5e4c214d82a8d9f4bdff9e0e6d",
  "status": "PROCESSING",
  "provider": "TEST",
  "message": "Payment request accepted. Awaiting customer completion."
}
```

**Possible primary statuses**

| Status | Meaning |
|---|---|
| `PROCESSING` | The provider accepted the request and customer completion is pending. For NOWPayments, instructions exist but funds are not yet confirmed. |
| `FAILED` | The provider rejected the request immediately or reported a failed/expired payment. |
| `PENDING_RECONCILIATION` | NOWPayments initiation was uncertain, the customer partially paid, or a pre-success refund was reported; an operator/reconciliation action is needed. |
| `CREATED` | The transaction is still waiting to start. |

**Failure cases**

- `404 Not Found` for invalid or expired checkout links
- `409 Conflict` when the checkout link has already been used or the payment can no longer be initiated
- `400 Bad Request` when a phone number is required or invalid
- For NOWPayments, provider configuration, estimate, or payment-creation failures are returned in the `201 Created` response as `FAILED` or `PENDING_RECONCILIATION`, without `payment_instructions`; these provider outcomes are not HTTP `503` responses.

## 5. Provider callback API

### 5.1 Receive a signed callback

**Endpoint**

`POST /v1/provider-callbacks`

**Authentication**

None. The request must be signed, and the backend validates the signature itself.

**Headers**

| Header | Required | Description |
|---|---|---|
| `x-provider-timestamp` | Yes | 13-digit epoch milliseconds string. |
| `x-provider-signature` | Yes | 64-character hex SHA-256 signature. |
| `Content-Type` | Yes | `application/json` |

**Raw-body signature rule**

The signature is validated against the exact request bytes, not a parsed object. The server computes:

```text
HMAC-SHA256(signingSecret, "${timestamp}.${rawBodyUtf8}")
```

with the `SIGNING_SECRET` environment variable or the local development fallback secret.

**Request body**

```json
{
  "event": "payment.updated",
  "providerReference": "provider-ref-123",
  "transactionReference": "sp_9d1a3f5e4c214d82a8d9f4bdff9e0e6d",
  "attemptReference": "d1a02b38-37d9-4d4b-94ff-c0e0140db3ec",
  "amount": 150.0,
  "currency": "MWK",
  "provider": "TEST",
  "status": "SUCCESSFUL",
  "occurredAt": "2026-11-07T12:28:10.000Z",
  "failureCode": null,
  "failureMessage": null
}
```

**Field rules**

| Field | Type | Required | Rules |
|---|---|---|---|
| `event` | string | Yes | Must be `payment.updated`. |
| `providerReference` | string | Yes | Must match the stored provider reference. |
| `transactionReference` | string | Yes | Must match the payment transaction public reference. |
| `attemptReference` | UUID | Yes | Must match an existing payment attempt row. |
| `amount` | number | Yes | Must be a finite decimal value equivalent to a valid tambala amount in MWK; e.g. `150.00` is valid. |
| `currency` | string | Yes | Must be exactly `MWK`. |
| `provider` | enum | Yes | Must match the payment provider on the persisted transaction and attempt. |
| `status` | enum | Yes | `SUCCESSFUL` or `FAILED`. |
| `occurredAt` | ISO date string | Yes | Must be valid date-time input. |
| `failureCode` | string | No | Only sent on failed payments. |
| `failureMessage` | string | No | Optional failed-payment reason. |

**Success response — `200 OK`**

```json
{
  "received": true,
  "duplicate": false
}
```

If the callback is a duplicate of a previously processed final result, the API also returns:

```json
{
  "received": true,
  "duplicate": true
}
```

**Security and validation rules**

- timestamp is rejected if it is missing, malformed, or older than five minutes
- invalid or missing signatures return `401 Unauthorized`
- mismatched transaction/provider references are rejected with `409 Conflict`
- contradictory or terminal-state changes are rejected rather than silently overwriting final state

## 6. Successful callback ledger posting

For the generic MWK callback, after the signed callback validates and conditionally transitions a payment and attempt to `SUCCEEDED`, the handler invokes `LedgerPostingService` with the same `Prisma.TransactionClient`. Payment status, attempt status, ledger transaction, entries, and balance projections commit or roll back together. Failed or unsupported outcomes do not create successful-payment ledger entries. Duplicate/concurrent callbacks cannot post the payment twice.

The posting uses the immutable fee snapshot stored when the payment was created. It does not query the current fee policy or recalculate the historical fee. Provider clearing is recorded as a receivable; it does not imply provider cash has settled. No external request, notification, webhook delivery, worker, or outbox is part of this transaction.

NOWPayments IPNs use `POST /v1/provider-callbacks/nowpayments` and a separate `CryptoLedgerPostingService`. A `finished` IPN posts the provider-reported `actually_paid` amount in the original crypto asset/network, applying `NOWPAYMENTS_FEE_BPS`; it is not converted into MWK or posted through the MWK fee snapshot. Payment, crypto detail, and crypto ledger entries are committed atomically. See [NOWPayments Crypto Integration](./nowpaymentsIntegration.md) for the IPN and lifecycle contract.

For the accounts, entry directions, fee configuration, and historical backfill/cutover instructions, see the [ledger module guide](./ledgerModule.md). No ledger posting endpoint is exposed.

## 7. Payment state model

The implemented status flow is intentionally conservative.

| Transaction status | Meaning |
|---|---|
| `CREATED` | Checkout session is active and no provider attempt has started yet. |
| `PROCESSING` | Provider request has been accepted and the customer is completing a payment flow. |
| `SUCCEEDED` | Provider callback marks the payment as successful. |
| `FAILED` | Provider callback or rejection result marks the payment as failed. |
| `PENDING_RECONCILIATION` | For NOWPayments, initiation had an ambiguous result, the customer partially paid, or a pre-success refund was reported. It requires reconciliation; a refund IPN after an already-recorded success does not reverse that success automatically. |

Provider attempts also track their own granular state. For NOWPayments, `UNKNOWN` covers ambiguous initiation and unresolved partial-payment/refund outcomes:

- `STARTED`
- `PROCESSING`
- `SUCCEEDED`
- `FAILED`
- `UNKNOWN`

## 8. Production caveats

This implementation is a backend payment workflow, not a complete production payment and settlement stack. `TEST` is the test adapter; `NOWPAYMENTS` is an implemented crypto adapter, but has not been validated against a live sandbox or production endpoint. Production deployments should:

- configure `CHECKOUT_BASE_URL` as a valid HTTPS base URL
- set a strong `SIGNING_SECRET` for provider callbacks
- disable the `TEST` provider in production
- validate NOWPayments against a live sandbox and confirm public IPN reachability
- add provider-specific Airtel Money and TNM Mpamba adapters and documented bank/provider parsers as requirements and sanitized specifications become available
- do not treat provider-clearing balances as settled cash or withdrawable merchant funds; settlement posting does not implement merchant fund release

See [nowpaymentsIntegration.md](./nowpaymentsIntegration.md) for the NOWPayments request/response contract and configuration. See the [ledger guide](./ledgerModule.md) for the implemented normalized settlement workflow.
