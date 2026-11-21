# NOWPayments Crypto Integration

This guide documents the NOWPayments crypto flow as implemented in the backend. It is intended for checkout clients and merchant dashboard developers.

## 1. Overview

Merchants can request payment directly in a supported cryptocurrency by supplying the asset, network, and exact decimal-string amount. The backend sends that amount as NOWPayments `pay_amount`, and a successful payment credits the merchant's balance in the same asset/network after applying `NOWPAYMENTS_FEE_BPS`. The MWK payment path remains separate. NOWPayments requires a fiat `price_amount`; the backend requests a USD estimate from NOWPayments for that provider-only reference, but this estimate does not change the transaction amount, currency, or crypto ledger balance. Crypto balances are not converted to MWK; any MWK equivalent is only a display estimate outside this payment flow.

1. Merchant creates a crypto transaction and receives a hosted checkout URL.
2. Customer opens checkout; the saved asset, network, and amount are displayed.
3. Checkout calls the initiation endpoint with `provider: "NOWPAYMENTS"`.
4. The backend requests a USD reference estimate, then creates the provider payment with the exact saved crypto amount as `pay_amount`.
5. Customer sends crypto to the returned address.
6. NOWPayments sends a signed IPN to the backend.
7. On `finished`, the backend records the actual amount received and posts the crypto merchant balance and fee atomically.

## 2. Endpoints

All routes use the global `/v1` prefix. Examples use `https://api.example.com`; replace it with the backend's public base URL.

### Create a crypto transaction

**`POST /v1/transactions`**

- **Auth:** Merchant JWT required (`Authorization: Bearer ...` or the `access_token` cookie); the route also uses `ArcjetGuard`.
- **Headers:** `Idempotency-Key` is required. Reusing the key with identical payment data returns the existing transaction; using it for different data returns `409 Conflict`.
- **Request body:**

```json
{
  "paymentType": "CRYPTO",
  "provider": "NOWPAYMENTS",
  "asset": "USDT",
  "network": "TRC20",
  "amount": "25.75000000",
  "description": "Order INV-2048",
  "merchantReference": "INV-2048"
}
```

`amount` is a positive decimal string with at most 18 integer and 18 fractional digits. `asset` and `network` must resolve to a supported pair. Native assets such as BTC use `"network": null`. Do not send `amountTambala` for a crypto transaction.

- **Response (`201 Created`):**

```json
{
  "publicReference": "sp_6f4894f6b4494cb49dc9a1f89ec7b264",
  "status": "CREATED",
  "paymentType": "CRYPTO",
  "provider": "NOWPAYMENTS",
  "asset": "USDT",
  "network": "TRC20",
  "amount": "25.75",
  "checkout_url": "https://checkout.example.com/checkout/6Kb3nM9m4jQv2XgD",
  "expires_at": "2026-11-21T16:30:00.000Z"
}
```

The amount is normalized without insignificant trailing zeroes. The server requires the merchant profile to be `APPROVED` (`403 Forbidden`, `ForbiddenException`). Invalid fields, unsupported pairs, and missing/invalid idempotency keys result in `400 Bad Request` (`BadRequestException`); a conflicting idempotency-key reuse results in `409 Conflict` (`ConflictException`). A missing/invalid `CHECKOUT_BASE_URL` or a stored transaction without its matching payment detail results in `500 Internal Server Error` (`InternalServerErrorException`). Authentication and Arcjet guards can reject the request before service validation.

```bash
curl -X POST "https://api.example.com/v1/transactions" \
  -H "Authorization: Bearer $MERCHANT_JWT" \
  -H "Idempotency-Key: inv-2048-crypto" \
  -H "Content-Type: application/json" \
  --data '{
    "paymentType": "CRYPTO",
    "provider": "NOWPAYMENTS",
    "asset": "USDT",
    "network": "TRC20",
    "amount": "25.75",
    "description": "Order INV-2048",
    "merchantReference": "INV-2048"
  }'
```

### Open hosted checkout

**`GET /v1/checkout/:token`**

- **Auth:** Public; access is controlled by the checkout token.
- **Response (`200 OK`):**

```json
{
  "reference": "sp_6f4894f6b4494cb49dc9a1f89ec7b264",
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

`404 Not Found` (`NotFoundException`) is returned for missing, expired, inactive, or consumed checkout links. `canPay` is true only while the transaction is `CREATED`. A corrupt transaction without its matching payment detail results in `500 Internal Server Error` (`InternalServerErrorException`).

```bash
curl "https://api.example.com/v1/checkout/6Kb3nM9m4jQv2XgD"
```

### Initiate NOWPayments checkout

**`POST /v1/checkout/:token/pay`**

- **Auth:** Public; the checkout token authorizes the operation. The route also uses `ArcjetGuard`.
- **Request body:**

```json
{
  "provider": "NOWPAYMENTS"
}
```

Do not send `payCurrency`, `network`, `amount`, or a phone number here. The selected asset, network, and amount were saved when the merchant created the transaction.

- **Accepted initiation response (`201 Created`):**

```json
{
  "reference": "sp_6f4894f6b4494cb49dc9a1f89ec7b264",
  "status": "PROCESSING",
  "provider": "NOWPAYMENTS",
  "message": "Payment request accepted. Awaiting customer completion.",
  "payment_instructions": {
    "paymentAddress": "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
    "payAmount": "25.75",
    "asset": "USDT",
    "network": "TRC20",
    "expiresAt": "2026-11-21T16:50:00.000Z"
  }
}
```

`payment_instructions` appears only when provider creation is accepted. A rejected or ambiguous initiation has no `payment_instructions`; it returns `FAILED` or `PENDING_RECONCILIATION` respectively, with the corresponding message. `PROCESSING` means the address/instructions exist, not that the payment is complete.

The endpoint returns `404 Not Found` (`NotFoundException`) for an invalid/expired link; `409 Conflict` (`ConflictException`) if the checkout is already used or the transaction is no longer `CREATED`; and `400 Bad Request` (`BadRequestException`) if the provider does not match the transaction type or a mobile-money phone number is missing. In the crypto path, NOWPayments configuration/estimate/create failures are represented in the `201 Created` response as `FAILED` or `PENDING_RECONCILIATION` and have no payment instructions; they are not returned as provider HTTP exceptions. Authentication is not required, but the route has Arcjet protection.

```bash
curl -X POST "https://api.example.com/v1/checkout/6Kb3nM9m4jQv2XgD/pay" \
  -H "Content-Type: application/json" \
  --data '{"provider":"NOWPAYMENTS"}'
```

### Read a merchant transaction

**`GET /v1/transactions/:reference`**

- **Auth:** Merchant JWT required; the reference must belong to that merchant.
- **Crypto response (`200 OK`):**

```json
{
  "publicReference": "sp_6f4894f6b4494cb49dc9a1f89ec7b264",
  "paymentType": "CRYPTO",
  "provider": "NOWPAYMENTS",
  "asset": "USDT",
  "network": "TRC20",
  "amount": "25.75",
  "status": "PROCESSING",
  "description": "Order INV-2048",
  "merchantReference": "INV-2048",
  "createdAt": "2026-11-21T16:00:00.000Z",
  "processedAt": null
}
```

`404 Not Found` (`NotFoundException`) is returned if the transaction does not exist for the authenticated merchant. An invalid merchant JWT is rejected by the auth guard; a corrupt transaction without its matching payment detail results in `500 Internal Server Error` (`InternalServerErrorException`).

```bash
curl "https://api.example.com/v1/transactions/sp_6f4894f6b4494cb49dc9a1f89ec7b264" \
  -H "Authorization: Bearer $MERCHANT_JWT"
```

### Receive NOWPayments IPNs

**`POST /v1/provider-callbacks/nowpayments`**

- **Auth:** No JWT. The endpoint verifies the NOWPayments `x-nowpayments-sig` header using `NOWPAYMENTS_IPN_SECRET`.
- **Request body:** See [Webhook payload reference](#3-webhook-payload-reference).
- **Response (`200 OK`):**

```json
{
  "received": true,
  "duplicate": false
}
```

Repeated notifications may return `"duplicate": true`. Missing/invalid signatures return `401 Unauthorized` (`UnauthorizedException`); an invalid payload or unknown provider payment ID returns `400 Bad Request` (`BadRequestException`); conflicting state/provider/attempt relationships return `409 Conflict` (`ConflictException`). A finished status without any `actually_paid` value on record raises `500 Internal Server Error` (`InternalServerErrorException`) and the transaction update rolls back.

```bash
curl -X POST "https://api.example.com/v1/provider-callbacks/nowpayments" \
  -H "Content-Type: application/json" \
  -H "x-nowpayments-sig: $VALID_IPN_SIGNATURE" \
  --data '{
    "payment_id": 123456789,
    "payment_status": "finished",
    "actually_paid": 25.75,
    "pay_amount": 25.75,
    "order_id": "d6cd7ed7-9967-4226-b245-73d2b63e65b3"
  }'
```

For real use, NOWPayments sends this request. A manually replayed request must be signed using the NOWPayments IPN signing algorithm and the configured secret; an arbitrary signature will be rejected.

## 3. Webhook payload reference

The controller losslessly parses provider numeric fields before validating the payload. On the wire, `payment_id`, `actually_paid`, and `pay_amount` can be JSON numbers; the guard receives them as decimal strings to avoid JavaScript floating-point rounding.

| Field | Required | Validated shape |
|---|---:|---|
| `payment_id` | Yes | Non-empty string after lossless parsing. |
| `payment_status` | Yes | One of `waiting`, `confirming`, `confirmed`, `sending`, `partially_paid`, `finished`, `failed`, `expired`, `refunded`. |
| `actually_paid` | No | Decimal string; exponent notation is accepted. |
| `pay_amount` | No | Decimal string; exponent notation is accepted. |
| `order_id` | No | String. |

Other fields that NOWPayments may send are not required by this payload guard. A status outside the allowlist is rejected as `400 Bad Request` before state mapping. The mapping is in [nowpayments-status.util.ts](../../src/payment-providers/adapters/nowpayments/nowpayments-status.util.ts).

## 4. Status lifecycle

### PaymentStatus

| Value | Meaning in this flow | Terminal? |
|---|---|---|
| `CREATED` | Crypto transaction and checkout exist; no provider attempt has started. | No; may become `PROCESSING`, `FAILED`, or `PENDING_RECONCILIATION`. |
| `PROCESSING` | NOWPayments instructions were accepted or provider reports a non-final status (`waiting`, `confirming`, `confirmed`, `sending`). | No. |
| `PENDING_RECONCILIATION` | Provider initiation outcome is ambiguous; NOWPayments reports `partially_paid`; or a pre-success `refunded` result needs manual resolution. | No; reconciliation may resolve it. |
| `SUCCEEDED` | NOWPayments reports `finished`; actual received crypto is posted to the crypto ledger. | Yes; a later refund IPN is recorded but does not reverse state or ledger automatically. |
| `FAILED` | Initiation was rejected, or NOWPayments reports `failed`/`expired`. | Yes. |

### PaymentAttemptStatus

| Value | Meaning in this flow | Terminal? |
|---|---|---|
| `STARTED` | Provider call is in progress. | No. |
| `PROCESSING` | Provider payment exists and is waiting for payment completion/status updates. | No. |
| `UNKNOWN` | Initiation or provider outcome is ambiguous, including partial payment/refund cases. | No; reconciliation may resolve it. |
| `SUCCEEDED` | NOWPayments reports `finished`. | Yes. |
| `FAILED` | Provider creation was rejected or the payment reports `failed`/`expired`. | Yes. |

When a payment is `finished`, ledger posting uses `actually_paid`, not merely the requested amount; fee and merchant net are calculated in the original asset/network. A `refunded` IPN received after success is retained for manual handling without automatic ledger reversal.

## 5. Environment and configuration

| Variable | Required/default | Purpose |
|---|---|---|
| `NOWPAYMENTS_API_KEY` | Required in production; no default. | Authenticates outbound estimate, create-payment, and status requests. Missing keys outside production allow startup but prevent successful provider calls. |
| `NOWPAYMENTS_IPN_SECRET` | Required in production; no default. | Verifies the `x-nowpayments-sig` IPN header. Missing secret causes IPN rejection. |
| `NOWPAYMENTS_BASE_URL` | Defaults to `https://api.nowpayments.io/v1`. | NOWPayments API base; use the documented sandbox base for sandbox testing. |
| `PUBLIC_API_BASE_URL` | Required in production; no default. | Public backend base embedded in the IPN callback URL. Production requires HTTPS. |
| `NOWPAYMENTS_FEE_BPS` | Defaults to `0`. | Crypto fee in basis points; must be an integer from `0` through `9999`. |
| `CHECKOUT_BASE_URL` | No default. | Base for generated hosted checkout URLs; must be configured as a valid HTTPS URL, except localhost is permitted for development. |
| `NODE_ENV` | Environment-provided. | In `production`, startup fails if the API key, IPN secret, or public HTTPS callback URL is missing. |

The required USD price reference is obtained from NOWPayments at initiation and is not controlled by an additional FX environment variable. `NOWPAYMENTS_FEE_BPS` affects crypto ledger fee/net only.

## 6. Known limitations

- **Stale/missing webhook reconciliation exists.** It runs immediately at startup and every 60 seconds when an API key is configured; it checks payments stale for at least 5 minutes, at most 50 per run. It is process-local, not a distributed scheduler.
- **Merchant crypto payouts are not implemented.** Crypto balances can be credited but cannot yet be withdrawn through this backend.
- **Ticker mapping is hand-maintained and intentionally incomplete.** Update [crypto-asset.util.ts](../../src/ledger/crypto-asset.util.ts) before enabling a new asset/network pair. The code does not automatically ingest NOWPayments' currency list.
- **Current crypto fee is 0 bps by default.** Set `NOWPAYMENTS_FEE_BPS` only to an approved value.
- **Provider API behavior needs sandbox validation.** The USD reference estimate is requested from NOWPayments because its create-payment API requires fiat `price_amount`; the exact requested crypto amount is sent separately as `pay_amount`.
- **Partial payments and refunds need an operational policy.** Partial payments enter pending reconciliation. A refund after success is retained for manual action; automatic reversals are not implemented.
