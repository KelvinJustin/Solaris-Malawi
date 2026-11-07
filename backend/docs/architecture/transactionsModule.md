# Solaris Malawi — Payment, Checkout, and Provider Callback API

## 1. Overview

The payment domain is implemented in the `transactions`, `checkout`, and `provider-callbacks` routes.

It covers:

- merchant-initiated payment transaction creation
- public hosted checkout sessions
- provider payment initiation from the checkout page
- signed provider callback verification
- state transitions for payment attempts and transactions

All routes are under the backend URI version prefix `/v1`.

## 2. Authentication and access rules

### Merchant transactions

Routes in `src/transactions/transactions.controller.ts` are protected by `JwtAuthGuard` and therefore require a valid merchant JWT cookie.

### Public checkout endpoints

The checkout routes in `src/transactions/checkout.controller.ts` are intentionally public. They validate the checkout token, not the caller's identity.

### Callback endpoint

`POST /v1/provider-callbacks` accepts unsigned provider callbacks over the public internet, but each request must include a timestamp and HMAC signature that matches the raw request body.

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

```json
{
  "amountTambala": 2500,
  "customerPhone": "+265991234567",
  "description": "Order #123",
  "merchantReference": "INV-123"
}
```

**Field rules**

| Field | Type | Required | Rules |
|---|---|---|---|
| `amountTambala` | integer | Yes | Must be an integer greater than or equal to 1 and not exceed `2_147_483_647`. |
| `customerPhone` | string | No | If provided, must be a valid Malawian phone number. |
| `description` | string | No | Maximum 255 characters. |
| `merchantReference` | string | No | Maximum 100 characters. |

**Permission rule**

The merchant's profile must be `APPROVED` before a transaction can be created. If the profile is not approved, the server returns `403 Forbidden`.

**Success response — `200 OK` or `201 Created`**

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
- Reusing the same `Idempotency-Key` with identical payload data returns the same checkout result instead of creating a new transaction.
- Reusing the same `Idempotency-Key` with different payment data results in `409 Conflict`.

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

The response is the persisted payment transaction record, for example:

```json
{
  "id": "d8d390c6-a8d2-4017-8a17-64f8b9f2bbd5",
  "publicReference": "sp_9d1a3f5e4c214d82a8d9f4bdff9e0e6d",
  "merchantId": "5bde7288-8b19-4db1-a7f7-f8d5a0547949",
  "amountTambala": 2500,
  "currency": "MWK",
  "status": "PROCESSING",
  "provider": "TEST",
  "providerReference": "provider-ref-123",
  "customerPhone": "+265991234567",
  "description": "Order #123",
  "merchantReference": "INV-123",
  "idempotencyKey": "request-123",
  "failureCode": null,
  "failureMessage": null,
  "createdAt": "2026-11-07T12:15:00.000Z",
  "updatedAt": "2026-11-07T12:16:00.000Z",
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
| `provider` | string | Yes | One of `AIRTEL_MONEY`, `TN_MPAMBA`, or `TEST`. |
| `phoneNumber` | string | Yes | Must be a valid Malawian phone number. |

**Success response — `200 OK`**

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
| `PROCESSING` | The provider accepted the request and customer completion is pending. |
| `FAILED` | The provider rejected the request immediately. |
| `PENDING_RECONCILIATION` | The provider response was uncertain or inconclusive. |
| `CREATED` | The transaction is still waiting to start. |

**Failure cases**

- `404 Not Found` for invalid or expired checkout links
- `409 Conflict` when the checkout link has already been used or the payment can no longer be initiated
- `400 Bad Request` when a phone number is required or invalid
- `503` style provider errors depending on the actual adapter implementation

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

## 6. Payment state model

The implemented status flow is intentionally conservative.

| Transaction status | Meaning |
|---|---|
| `CREATED` | Checkout session is active and no provider attempt has started yet. |
| `PROCESSING` | Provider request has been accepted and the customer is completing a payment flow. |
| `SUCCEEDED` | Provider callback marks the payment as successful. |
| `FAILED` | Provider callback or rejection result marks the payment as failed. |
| `PENDING_RECONCILIATION` | Final provider outcome is uncertain and manual reconciliation is needed. |

Provider attempts also track their own granular state:

- `STARTED`
- `PROCESSING`
- `SUCCEEDED`
- `FAILED`
- `UNKNOWN`

## 7. Production caveats

This implementation is intentionally a backend payment workflow, not a complete production settlement stack. The current live provider adapter is a local/test implementation. Production deployments should:

- configure `CHECKOUT_BASE_URL` as a valid HTTPS base URL
- set a strong `SIGNING_SECRET` for provider callbacks
- disable the `TEST` provider in production
- add real provider adapters for Airtel Money and TNM Mpamba as needed
- add worker reconciliation and settlement workflows for payment status processing
