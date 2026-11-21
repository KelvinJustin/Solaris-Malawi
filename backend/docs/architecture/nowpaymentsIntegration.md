# NOWPayments Crypto Payment Integration

## OVERVIEW

The backend can create a NOWPayments invoice for a Solaris-hosted checkout. A customer pays in the cryptocurrency selected by the frontend, and NOWPayments later reports the final outcome through a signature-verified IPN webhook. A successful, uniquely posted result credits the merchant's crypto ledger balance in the original asset and network (for example USDT on TRC20). The `PaymentTransaction` remains denominated in MWK for its original payment request and fee snapshot; MWK is **display-estimate only** for crypto and is not converted or posted to the merchant's crypto balance.

1. A merchant creates a payment transaction.
2. Solaris creates and returns a hosted checkout URL.
3. The customer opens the checkout, selects `NOWPAYMENTS`, and submits a NOWPayments pay currency.
4. Solaris creates a NOWPayments invoice and returns a payment address and crypto amount.
5. The customer pays using that address and amount.
6. NOWPayments sends `POST /v1/provider-callbacks/nowpayments`.
7. Solaris validates the IPN, updates the payment status, and posts a successful payment to the merchant crypto ledger.

The API uses URI versioning. Although `main.ts` does not call `app.setGlobalPrefix()`, it enables default URI version `1`, so all routes below are under `/v1`.

## ENDPOINTS

### 1. Create a checkout transaction

**Method and path:** `POST /v1/transactions`

**Authentication:** Merchant JWT required. Use the `access_token` HTTP-only cookie or `Authorization: Bearer <jwt>`. The guard also uses Arcjet.

**Headers:**

```http
Idempotency-Key: merchant-order-2026-001
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example
Content-Type: application/json
```

`Idempotency-Key` is required and is limited to 255 characters.

**Request body:**

```json
{
  "amountTambala": 50000,
  "customerPhone": "+265991234567",
  "description": "Website order 2026-001",
  "merchantReference": "merchant-order-2026-001"
}
```

Field rules:

- `amountTambala`: integer, 1 through 2147483647. Tambala is 1/100 of MWK.
- `customerPhone`: optional; when present, must be a valid Malawian phone number.
- `description`: optional string, maximum 255 characters.
- `merchantReference`: optional string, maximum 100 characters.

`currency` is always set to `MWK` by the backend.

**Successful response, with a reusable active checkout session:**

```json
{
  "publicReference": "sp_01f2b7c4e5a84a2abce3",
  "status": "CREATED",
  "amountTambala": 50000,
  "currency": "MWK",
  "checkout_url": "https://pay.example.com/v1/checkout/opaque-token",
  "expires_at": "2026-11-21T12:36:27.327Z"
}
```

If the same idempotency key is retried after the original session has expired or been consumed, the response is:

```json
{
  "publicReference": "sp_01f2b7c4e5a84a2abce3",
  "status": "PROCESSING",
  "amountTambala": 50000,
  "currency": "MWK",
  "checkout_url": null,
  "expires_at": null
}
```

The status and session details are read from the existing transaction; the endpoint does not create or reopen a duplicate checkout.

**Errors:**

| Status | Exception | When |
|---|---|---|
| `400 Bad Request` | `BadRequestException` / Nest validation | Missing or invalid `Idempotency-Key`, or any invalid/unknown request field, amount, or phone number |
| `403 Forbidden` | `ForbiddenException` | Authenticated merchant's profile is not `APPROVED` |
| `409 Conflict` | `ConflictException` | The idempotency key was already used with different payment details |
| `429 Too Many Requests` | Arcjet `HttpException` | Rate limit denied |
| `403 Forbidden` | Arcjet `HttpException` | Bot detected or another Arcjet block |
| `401 Unauthorized` | Passport JWT / `UnauthorizedException` | Missing, expired, revoked, invalid, or suspended merchant identity |

**Curl:**

```bash
curl --fail-with-body \
  -b 'access_token=<merchant-jwt>' \
  -H 'Idempotency-Key: merchant-order-2026-001' \
  -H 'Content-Type: application/json' \
  -d '{
    "amountTambala": 50000,
    "customerPhone": "+265991234567",
    "description": "Website order 2026-001",
    "merchantReference": "merchant-order-2026-001"
  }' \
  'http://localhost:3000/v1/transactions'
```

### 2. Read a transaction

**Method and path:** `GET /v1/transactions/:reference`

**Authentication:** Merchant JWT required. Use the `access_token` cookie or bearer header. The route is also protected by Arcjet.

**Request body:** None.

**Successful response:**

```json
{
  "publicReference": "sp_01f2b7c4e5a84a2abce3",
  "amountTambala": 50000,
  "currency": "MWK",
  "status": "PROCESSING",
  "provider": "NOWPAYMENTS",
  "description": "Website order 2026-001",
  "merchantReference": "merchant-order-2026-001",
  "createdAt": "2026-11-21T12:06:27.327Z",
  "processedAt": null
}
```

`provider` can be `NOWPAYMENTS`, `AIRTEL_MONEY`, `TN_MPAMBA`, or `TEST`. `processedAt` is set only for a terminal provider result.

**Errors:**

| Status | Exception | When |
|---|---|---|
| `404 Not Found` | `NotFoundException` | Reference is unknown or belongs to another merchant |
| `401 Unauthorized` | Passport JWT / `UnauthorizedException` | Missing, expired, revoked, invalid, or suspended merchant identity |
| `429 Too Many Requests` | Arcjet `HttpException` | Rate limit denied |
| `403 Forbidden` | Arcjet `HttpException` | Bot detected or blocked |

**Curl:**

```bash
curl --fail-with-body \
  -b 'access_token=<merchant-jwt>' \
  'http://localhost:3000/v1/transactions/sp_01f2b7c4e5a84a2abce3'
```

### 3. Read hosted checkout details

**Method and path:** `GET /v1/checkout/:token`

**Authentication:** Public. No merchant JWT is used. The checkout token in the path is the authority.

**Request body:** None.

**Successful response:**

```json
{
  "reference": "sp_01f2b7c4e5a84a2abce3",
  "amountTambala": 50000,
  "currency": "MWK",
  "description": "Website order 2026-001",
  "status": "CREATED",
  "canPay": true
}
```

`canPay` is `true` only when the transaction status is `CREATED`.

**Errors:**

| Status | Exception | When |
|---|---|---|
| `404 Not Found` | `NotFoundException` | Token is missing/longer than 200 characters, unknown, consumed, revoked, or expired |

**Curl:**

```bash
curl --fail-with-body \
  'http://localhost:3000/v1/checkout/opaque-token'
```

### 4. Initiate NOWPayments from a hosted checkout

**Method and path:** `POST /v1/checkout/:token/pay`

**Authentication:** Public checkout endpoint. No merchant JWT; the opaque checkout token and active checkout session are checked by the service. The route is protected by Arcjet.

**Request body:**

```json
{
  "provider": "NOWPAYMENTS",
  "payCurrency": "usdttrc20",
  "network": "TRC20"
}
```

Actual DTO rules:

- `provider`: required enum; use exactly `NOWPAYMENTS`.
- `payCurrency`: required string for NOWPayments. Examples include `usdttrc20`, `usdterc20`, `btc`, `eth`, and `trx`.
- `network`: optional string. It is display metadata and the NOWPayments response's network value wins when the provider supplies one.
- `phoneNumber`: optional DTO field but not required or meaningful for NOWPayments.

**Response when NOWPayments returns usable payment instructions:**

```json
{
  "reference": "sp_01f2b7c4e5a84a2abce3",
  "status": "PROCESSING",
  "provider": "NOWPAYMENTS",
  "message": "Payment request accepted. Awaiting customer completion.",
  "payment_instructions": {
    "paymentAddress": "TExampleNOWPaymentsDepositAddress",
    "payAmount": "12.345678",
    "payCurrency": "usdttrc20",
    "network": "TRC20",
    "expiresAt": "2026-11-21T12:36:27.327Z"
  }
}
```

`payment_instructions` is present only for an accepted NOWPayments invoice. Creating the invoice does not mean the customer has paid.

**Response when NOWPayments rejects or cannot answer invoice creation:**

```json
{
  "reference": "sp_01f2b7c4e5a84a2abce3",
  "status": "FAILED",
  "provider": "NOWPAYMENTS",
  "message": "Payment failed or the provider rejected the request."
}
```

For an unclassified/unknown result, the response shape is the same without `payment_instructions`, but `status` is `PENDING_RECONCILIATION` and the message is:

```json
{
  "reference": "sp_01f2b7c4e5a84a2abce3",
  "status": "PENDING_RECONCILIATION",
  "provider": "NOWPAYMENTS",
  "message": "Payment outcome is uncertain and requires reconciliation."
}
```

Internally, provider rejection codes can include `CONFIG_MISSING`, `FX_QUOTE_STALE`, `FX_CONVERSION_FAILED`, or `PROVIDER_REQUEST_FAILED`, but the public HTTP response does not currently expose `failureCode` or `failureMessage`.

**Errors:**

| Status | Exception | When |
|---|---|---|
| `400 Bad Request` | `BadRequestException` / Nest validation | `payCurrency` is missing/blank, or DTO validation rejects the body |
| `404 Not Found` | `NotFoundException` | Checkout token is unknown, inactive, consumed, or expired |
| `409 Conflict` | `ConflictException` | The transaction is no longer `CREATED`, or the checkout/transaction has already been claimed concurrently |
| `503 Service Unavailable` | `ServiceUnavailableException` | NOWPayments API key is not configured, or the NOWPayments API cannot be reached |
| `502 Bad Gateway` | `BadGatewayException` | NOWPayments returns a non-OK HTTP response or a non-JSON/unusable response |
| `500 Internal Server Error` | `InternalServerErrorException` | `PUBLIC_API_BASE_URL`, `CHECKOUT_BASE_URL`, or FX/crypto posting configuration is invalid/missing |
| `429 Too Many Requests` | Arcjet `HttpException` | Rate limit denied |
| `403 Forbidden` | Arcjet `HttpException` | Bot detected or blocked |

An accepted NOWPayments HTTP response is still followed by a normal `200` initiation response. Provider `REJECTED` and `UNKNOWN` outcomes are encoded in the JSON `status` field rather than being thrown as provider-specific HTTP errors in every case.

**Curl:**

```bash
curl --fail-with-body \
  -H 'Content-Type: application/json' \
  -d '{
    "provider": "NOWPAYMENTS",
    "payCurrency": "usdttrc20",
    "network": "TRC20"
  }' \
  'http://localhost:3000/v1/checkout/opaque-token/pay'
```

### 5. NOWPayments IPN webhook

**Method and path:** `POST /v1/provider-callbacks/nowpayments`

**Authentication:** **Not JWT-authenticated.** It is public and verified with NOWPayments IPN HMAC-SHA512 signing. The signature is carried in the `x-nowpayments-sig` header. The backend recursively sorts the parsed JSON keys, JSON-serializes that sorted object, and calculates HMAC-SHA512 using `NOWPAYMENTS_IPN_SECRET`. It does not validate the generic `x-provider-signature` or `x-provider-timestamp` headers on this route.

**Request body:** The validated subset described in “WEBHOOK PAYLOAD REFERENCE” below.

**Success response:**

New update:

```json
{
  "received": true,
  "duplicate": false
}
```

Repeated/same-state update:

```json
{
  "received": true,
  "duplicate": true
}
```

**Errors:**

| Status | Exception | When |
|---|---|---|
| `400 Bad Request` | `BadRequestException` | Payload is missing required fields or is not one of the recognized status values, or `payment_id` is unknown |
| `401 Unauthorized` | `UnauthorizedException` | `x-nowpayments-sig` is missing or HMAC verification fails |
| `409 Conflict` | `ConflictException` | The payment belongs to another provider, a finished payment is replayed with a different `actually_paid`, a duplicate final update conflicts with stored state, or payment/attempt state changed concurrently |
| `500 Internal Server Error` | `InternalServerErrorException` | Successful crypto posting has no immutable merchant snapshot or `actually_paid`, fee calculation is invalid, or the crypto ledger account/posting cannot be completed |

The controller's signature check runs before payload-shape validation. Every signature-verified IPN that reaches `handleNowPaymentsCallback` is also recorded in `crypto_payment_ipn_events` before state reconciliation.

**Curl:**

To run this locally, replace `NOWPAYMENTS_IPN_SECRET` and the example values; the signature must be calculated over the recursively key-sorted JSON body:

```bash
PAYLOAD='{"payment_id":"5855453484","payment_status":"finished","actually_paid":12.345678,"pay_amount":12.4,"order_id":"0192b7c4-8d5a-7abc-b123-0123456789ab"}'
SECRET='replace-with-your-ipn-secret'
SIG=$(NOWPAYMENTS_IPN_SECRET="$SECRET" node -e "const crypto=require('crypto');const s=process.env.NOWPAYMENTS_IPN_SECRET;const p=JSON.parse(process.argv[1]);function sort(v){if(Array.isArray(v))return v.map(sort);if(v&&typeof v==='object')return Object.keys(v).sort().reduce((o,k)=>(o[k]=sort(v[k]),o),{});return v}process.stdout.write(crypto.createHmac('sha512',s).update(JSON.stringify(sort(p))).digest('hex'))" "$PAYLOAD")
curl --fail-with-body \
  -H 'Content-Type: application/json' \
  -H "x-nowpayments-sig: $SIG" \
  -d "$PAYLOAD" \
  'http://localhost:3000/v1/provider-callbacks/nowpayments'
```

## WEBHOOK PAYLOAD REFERENCE

The guard in [nowpayments-webhook-payload.guard.ts](../../src/payment-providers/adapters/nowpayments/nowpayments-webhook-payload.guard.ts) accepts only this subset:

```json
{
  "payment_id": "5855453484",
  "payment_status": "finished",
  "actually_paid": 12.345678,
  "pay_amount": 12.4,
  "order_id": "0192b7c4-8d5a-7abc-b123-0123456789ab"
}
```

| Field | Required? | Type | Validation |
|---|---|---|---|
| `payment_id` | Yes | string | Non-empty; must equal a stored NOWPayments payment id |
| `payment_status` | Yes | string | Must be one of `waiting`, `confirming`, `confirmed`, `sending`, `partially_paid`, `finished`, `failed`, `expired`, `refunded` |
| `actually_paid` | No | number | Finite and greater than or equal to 0 when present |
| `pay_amount` | No | number | Finite and greater than or equal to 0 when present |
| `order_id` | No | string | No additional length or format validation |

Unknown fields are ignored only at the guard-level object; the handler does not reconstruct or expose extra NOWPayments fields.

If `payment_status` is an unrecognized string, the webhook is rejected with `400 Bad Request` and `Unrecognized NOWPayments callback payload`. The supported-status set and field guard are in [nowpayments-webhook-payload.guard.ts](../../src/payment-providers/adapters/nowpayments/nowpayments-webhook-payload.guard.ts). Status behavior is decided in [nowpayments-status.util.ts](../../src/payment-providers/adapters/nowpayments/nowpayments-status.util.ts).

## STATUS LIFECYCLE

For this provider, the status mapping is:

| NOWPayments status | `PaymentStatus` | `PaymentAttemptStatus` | Meaning | Terminal? / transition behavior |
|---|---|---|---|---|
| `waiting` | `PROCESSING` | `PROCESSING` | Invoice awaiting a payment | No; can move to confirming, paid, failed, expired, or partial states |
| `confirming` | `PROCESSING` | `PROCESSING` | Funds have arrived and are confirming | No; can move toward finished or another outcome |
| `confirmed` | `PROCESSING` | `PROCESSING` | Payment is confirmed in NOWPayments | No; can move toward sending or finished |
| `sending` | `PROCESSING` | `PROCESSING` | Funds are being sent or settled | No |
| `partially_paid` | `PENDING_RECONCILIATION` | `UNKNOWN` | Customer sent less than the quoted amount; not a success and not automatically failed | No; remains available for reconciliation or later status updates |
| `finished` | `SUCCEEDED` | `SUCCEEDED` | Payment completed; `actually_paid` is required before the crypto ledger can be posted | Yes; terminal success, and duplicate same-status callbacks return `duplicate: true` |
| `failed` | `FAILED` | `FAILED` | NOWPayments reports a final failure | Yes |
| `expired` | `FAILED` | `FAILED` | Invoice/payment window expired | Yes |
| `refunded` | `PENDING_RECONCILIATION` | `UNKNOWN` | A refund or post-success reversal requires human/ledger review | Defined terminal by NOWPayments, but not a normal crypto success; no automatic reversal or success-to-failure rewrite occurs |

Other internal values:

| Status | Value used by this flow | Meaning |
|---|---|---|
| `PaymentStatus.CREATED` | Before invoice initiation | Checkout exists but payment provider has not started |
| `PaymentStatus.PROCESSING` | Invoice accepted or waiting/confirming/sending | Awaiting final customer/provider outcome |
| `PaymentStatus.SUCCEEDED` | NOWPayments `finished` | Merchant crypto ledger posting completed in the callback/reconciliation transaction |
| `PaymentStatus.FAILED` | NOWPayments `failed` or `expired`; or invoice rejected | No crypto ledger success posting |
| `PaymentStatus.PENDING_RECONCILIATION` | `UNKNOWN` initiation, `partially_paid`, or `refunded` | Specifically for partial payment/refund-review or an unknown initiation/outcome; it is not a generic ambiguous dashboard state |
| `PaymentAttemptStatus.STARTED` | Attempt row created before provider I/O | Claimed checkout, but provider response pending |
| `PaymentAttemptStatus.PROCESSING` | Invoice accepted or in-progress NOWPayments status | Provider has work outstanding |
| `PaymentAttemptStatus.SUCCEEDED` | NOWPayments `finished` | Terminal success |
| `PaymentAttemptStatus.FAILED` | NOWPayments `failed`/`expired` or invoice rejection | Terminal failure |
| `PaymentAttemptStatus.UNKNOWN` | Unknown invoice result, partial payment, or refund | Awaiting reconciliation/review |

Once `SUCCEEDED` or `FAILED`, the normal callback state machine refuses contradictory status changes. If NOWPayments sends `refunded` after `finished`, that status is not mapped back to `FAILED` or automatically reversed in the ledger. It is recorded and is left at `PENDING_RECONCILIATION` for review only if the guarded transaction permits it; the code does not currently perform a ledger reversal.

## ENVIRONMENT / CONFIGURATION REQUIRED

### NOWPayments

| Variable | Read from | Required? | Default / behavior |
|---|---|---|---|
| `NOWPAYMENTS_API_KEY` | `nowpayments.config.ts` | Production: required. Development/test: optional; reconciliation and API creation are unavailable or fail safely without it | No default |
| `NOWPAYMENTS_IPN_SECRET` | `nowpayments.config.ts` and webhook controller | Production: required | No default |
| `NOWPAYMENTS_BASE_URL` | `nowpayments.config.ts` | Optional | `https://api.nowpayments.io/v1` |
| `PUBLIC_API_BASE_URL` | `nowpayments.config.ts` | Production: required and must start with `https://`. Development: optional; if absent, invoice initiation returns `CONFIG_MISSING` | No default |
| `NOWPAYMENTS_PRICE_CURRENCY` | `nowpayments.config.ts` | Optional | `usd`; NOWPayments does not receive MWK as `price_currency` |
| `NOWPAYMENTS_MAX_FX_QUOTE_AGE_SECONDS` | `nowpayments.config.ts` | Optional | `300` |
| `NOWPAYMENTS_FEE_BPS` | `nowpayments.config.ts` | Optional | `0`; integer 0 through 9999, where 100 bps = 1%. The code rejects any other value at config load |

Sandbox uses `https://api-sandbox.nowpayments.io/v1`; production uses `https://api.nowpayments.io/v1`. Sandbox and production require separate API keys and IPN secrets.

In production, `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, and a public HTTPS `PUBLIC_API_BASE_URL` fail at application boot. Outside production, missing values do not necessarily fail boot, but NOWPayments initiation and reconciliation behave accordingly.

### FX quote

| Variable | Read from | Required? | Default / behavior |
|---|---|---|---|
| `FX_RATE_API_BASE_URL` | `fx.config.ts` | Optional | `https://open.er-api.com/v6/latest` |
| `FX_RATE_POLL_INTERVAL_MS` | `fx.config.ts` | Optional | `15000` milliseconds |

The provider requests `${FX_RATE_API_BASE_URL}/MWK`, caches the target-currency rate, and accepts a quote for NOWPayments only if its capture age is within `NOWPAYMENTS_MAX_FX_QUOTE_AGE_SECONDS`. The upstream source republishes daily, so the poll interval only improves cache outage detection; it does not create fresher exchange-rate data.

### Hosted checkout and API authentication

| Variable | Read from | Required? | Default / behavior |
|---|---|---|---|
| `CHECKOUT_BASE_URL` | `TransactionsService` | Required for successful checkout URL creation | No default; must be an HTTPS URL or `http://localhost`, with no query or fragment |
| `JWT_SECRET` | Merchant JWT strategy | Required; merchant create/status endpoints fail authentication setup without it | No default |
| `DATABASE_URL` | `DatabaseService` | Required | No default |
| `NODE_ENV` | NOWPayments config and several guards | Optional for general config | No default in config itself; set to `production` for production fail-fast behavior and to disable the test provider |
| `PORT` | `main.ts` | Optional | `3000` |
| `FRONTEND_URL` | `main.ts` | Optional CORS origin | `http://localhost:5173` |
| `ARCJET_KEY` | Arcjet module | Required for Arcjet-protected checkout and merchant transaction routes where Arcjet is enabled | No default |
| `ARCJET_ENV` | Arcjet module | Optional | `.env.example` uses `development` |

The NOWPayments webhook itself does not read `SIGNING_SECRET`; that variable belongs to the separate generic provider-callback route.

## KNOWN LIMITATIONS

- **Missing-IPN reconciliation exists.** `NowPaymentsReconciliationService` runs immediately at module initialization and every 60,000 ms (60 seconds) while `NOWPAYMENTS_API_KEY` is configured. It queries at most 50 stale crypto payment detail rows, where `updatedAt` is at least 5 minutes old and the attempt/transaction is still processing or reconciliation-pending. It calls `GET /payment/{payment_id}` on NOWPayments and feeds accepted responses through the same guarded callback state path. It is process-local polling, not a durable distributed job, and successful/failed/refunded detail rows are generally excluded through the candidate rules.
- **Crypto payouts are not implemented.** The current code can credit crypto balances, but it has no payout or withdrawal endpoint or flow. Do not present a crypto balance as withdrawable yet.
- **Currency mapping is hand-maintained.** [crypto-asset.util.ts](../../src/ledger/crypto-asset.util.ts) maps known tickers such as `usdttrc20`, `usdterc20`, `btc`, and `eth` to asset/network ledger dimensions. It is not an exhaustive NOWPayments currency list. Unknown tickers fall back to the uppercase raw ticker with no network. Check NOWPayments' `GET /v1/full-currencies` or `GET /v1/currencies` and update the table before enabling a new or unfamiliar ticker.
- **Crypto fee default is zero.** `NOWPAYMENTS_FEE_BPS` defaults to `0` in code and in `.env.example`. With 0 bps, the merchant crypto ledger receives the full NOWPayments `actually_paid` amount. A non-zero approved value subtracts `feeAmount = actuallyPaid * feeBps / 10000`; the remainder is credited to the merchant, and the remainder beyond it is posted to platform crypto fee revenue.
- **There is no crypto-balance HTTP dashboard endpoint.** Balances exist in `crypto_ledger_accounts` and `crypto_ledger_account_balances`, keyed by merchant, asset, and network. This backend does not currently expose a GET route for that balance. A frontend or backend dashboard must wait for an endpoint that explicitly reads that ledger projection; polling `GET /v1/transactions/:reference` only gives transaction status and MWK transaction fields.
- **MWK is not a crypto-credit unit.** Successful crypto posting creates debit/credit crypto ledger entries for the paid asset and does not post the MWK `amountTambala` to the merchant crypto balance.
- **Database migrations must be applied to the same database the app uses.** `prisma generate` only generates the client; it does not create database tables. Production startup through `npm run start:prod` runs `prisma migrate deploy` before starting Nest. If a deployment starts the app another way, run `npx prisma migrate deploy --config prisma7.config.ts` as a release step against that deployment's `DATABASE_URL`. Use `migrate deploy` in production, not `migrate dev`. A `P2021` / “table does not exist” message for `crypto_payment_details` means the crypto-payment migration has not been applied to that database.
