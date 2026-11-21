# Solaris API Collection

Bruno requests for the Solaris Malawi backend. This guide describes the requests currently in this collection and the request/response shapes implemented by the backend.

## Base URL and response conventions

The **Smartpay** Bruno environment defines `baseUrl` as the API origin, without the version prefix:

```text
http://localhost:3000
```

The backend adds `/v1` globally. Set `baseUrl` to the origin for your environment (for example, `https://api.example.mw`); do not append `/v1`.

The examples below use valid JSON with representative values. Replace UUIDs, references, codes, URLs, and dates with values returned by earlier requests or created in your environment. The backend applies strict DTO validation: unknown request properties are rejected, and body fields not shown below should not be sent.

Unless stated otherwise, successful `GET`, `PATCH`, and `DELETE` requests return `200`. NestJS defaults successful `POST` requests to `201`; the login, logout, resend-verification, and callback routes that explicitly override this return `200`. Error responses use the NestJS JSON shape:

```json
{
  "statusCode": 400,
  "message": "A description of the error",
  "error": "Bad Request"
}
```

Validation errors may return `message` as an array of validation messages. Common status codes are `400` for invalid input or state, `401` for missing/invalid authentication or signatures, `403` for insufficient role or account state, `404` for missing resources, and `409` for conflicting state or duplicate data. The specific condition depends on the endpoint.

## Authentication and cookies

Merchant and admin authentication use separate HTTP-only cookies; JWTs are not returned in JSON. Bruno should retain cookies between requests. Browser clients must send requests with credentials enabled (for example, `credentials: "include"`), and the backend CORS origin must match the frontend origin.

- Merchant-protected routes require the merchant `access_token` cookie.
- Admin-protected routes require the `admin_access_token` cookie.
- Merchant and admin sessions are not interchangeable.
- Checkout reads and payment initiation are public; callback routes use signatures, not JWT cookies.
- Some authenticated routes are additionally subject to Arcjet protection and may return `403` or `429`.

## Request sequence

1. Register a merchant, verify the email OTP, then use merchant login and login OTP verification for subsequent sessions.
2. Complete the merchant profile and required document uploads, then submit it for review.
3. An admin reviews the application. The merchant must be approved before creating payment transactions.
4. Create a transaction, open its checkout URL, and initiate the payment there.
5. Provider callbacks update payment status. Admin settlement requests import and reconcile provider and bank data.

Admin users are provisioned separately; the collection does not create admin accounts.

# Endpoints

## System

### API Status — `GET /v1/test`

Returns a simple backend availability message. Public; no body or authentication required.

**Input:** none.

**Successful response — `200`:**

```text
message: solaris API is working
```

## Authentication

### Merchant Register — `POST /v1/auth/register`

Creates a merchant account, creates its initial profile, and sends an email-verification code. Public; Arcjet-protected.

**Input — JSON:**

```json
{
  "name": "Jane Banda",
  "email": "jane@example.com",
  "password": "TestPassword123!",
  "phone": "+265991234577"
}
```

`name` is 2–100 characters, `password` is at least 6 characters, `email` must be valid, and `phone` must be a Malawi phone number.

**Successful response — `201`:**

```json
{
  "message": "Verification email sent",
  "email": "jane@example.com"
}
```

### Verify Merchant Email — `POST /v1/auth/verify-email`

Verifies the registration OTP and starts a merchant session. Public; Arcjet-protected. The OTP is delivered to the registered email. The response sets the HTTP-only `access_token` cookie; it does not return the JWT in JSON.

**Input — JSON:**

```json
{
  "email": "jane@example.com",
  "code": "598182"
}
```

`code` must be exactly six digits.

**Successful response — `201`:**

```json
{
  "message": "Email verified successfully",
  "redirectTo": "/home"
}
```

### Merchant Login — `POST /v1/auth/login`

Checks the merchant password and sends a one-time login code. This is the first step of login; it does not create a session yet. Public; Arcjet-protected.

**Input — JSON:**

```json
{
  "email": "jane@example.com",
  "password": "TestPassword123!"
}
```

**Successful response — `201`:**

```json
{
  "message": "Login verification code sent",
  "email": "jane@example.com"
}
```

### Verify Merchant Login OTP — `POST /v1/auth/verify-login`

Verifies the login code and starts a merchant session. Public; Arcjet-protected. The response sets the HTTP-only `access_token` cookie.

**Input — JSON:**

```json
{
  "email": "jane@example.com",
  "code": "777899"
}
```

**Successful response — `201`:**

```json
{
  "message": "Login successful",
  "redirectTo": "/home"
}
```

### Resend Email Verification — `POST /v1/auth/resend-verification`

Requests a replacement email-verification code. Public; Arcjet-protected. The response is intentionally generic whether or not the address belongs to an unverified merchant. A resend is subject to a one-minute cooldown.

**Input — JSON:**

```json
{
  "email": "jane@example.com"
}
```

**Successful response — `200`:**

```json
{
  "message": "If that account is awaiting verification, a new code has been sent"
}
```

### Merchant Session — `GET /v1/auth/me`

Returns the current merchant identity. Requires the merchant `access_token` cookie.

**Input:** no body.

**Successful response — `200`:**

```json
{
  "userId": "11111111-1111-4111-8111-111111111111",
  "email": "jane@example.com"
}
```

### Merchant Logout — `POST /v1/auth/logout`

Revokes the current merchant session and clears the `access_token` cookie. Requires the merchant `access_token` cookie.

**Input:** no body.

**Successful response — `200`:**

```json
{
  "message": "Logged out successfully"
}
```

### Delete Merchant Account — `DELETE /v1/auth/account`

Soft-deletes the authenticated merchant account and suspends its profile if present. Financial and audit records are retained. Requires the merchant `access_token` cookie. This action is not a hard delete.

**Input:** no body.

**Successful response — `200`:**

```json
{
  "message": "Account deleted successfully"
}
```

### Admin Login — `POST /v1/admin-auth/login`

Authenticates a provisioned admin and sets the HTTP-only `admin_access_token` cookie. Public; Arcjet-protected. The JWT is not returned in the response body.

**Input — JSON:**

```json
{
  "email": "seed.admin@solaris.local",
  "password": "DevAdminPassword123!"
}
```

**Successful response — `200`:**

```json
{
  "message": "Admin login successful",
  "admin": {
    "id": "22222222-2222-4222-8222-222222222222",
    "name": "Solaris Admin",
    "email": "seed.admin@solaris.local",
    "role": "SUPER_ADMIN"
  }
}
```

### Admin Session — `GET /v1/admin-auth/me`

Returns the current admin identity. Requires the admin `admin_access_token` cookie.

**Input:** no body.

**Successful response — `200`:**

```json
{
  "id": "22222222-2222-4222-8222-222222222222",
  "email": "seed.admin@solaris.local",
  "role": "SUPER_ADMIN"
}
```

### Admin Logout — `POST /v1/admin-auth/logout`

Revokes the current admin session and clears the `admin_access_token` cookie. Requires the admin `admin_access_token` cookie.

**Input:** no body.

**Successful response — `200`:**

```json
{
  "message": "Admin logged out successfully"
}
```

## Merchants

All merchant profile and document endpoints below require the merchant `access_token` cookie.

### Get Merchant Profile — `GET /v1/merchants/profile`

Returns the merchant profile and document metadata.

**Input:** no body.

**Successful response — `200`:**

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "merchantId": "11111111-1111-4111-8111-111111111111",
  "businessName": "Banda Farms",
  "tradingName": "Banda Fresh Produce",
  "businessType": "SOLE_TRADER",
  "businessRegistrationNo": "BR-2024-1187",
  "taxIdentificationNo": "TIN-3098765",
  "merchantCategoryCode": "5411",
  "industryDescription": "Fresh produce retail",
  "supportEmail": "support@bandafarms.mw",
  "supportPhone": "+265991234567",
  "websiteUrl": "https://bandafarms.mw",
  "addressLine1": "Plot 45, Area 47",
  "addressLine2": null,
  "city": "Lilongwe",
  "district": "Lilongwe",
  "country": "MW",
  "logoUrl": null,
  "accountStatus": "PENDING_SUBMISSION",
  "rejectionReason": null,
  "submittedAt": null,
  "approvedAt": null,
  "approvedById": null,
  "createdAt": "2026-11-21T12:00:00.000Z",
  "updatedAt": "2026-11-21T12:00:00.000Z",
  "documents": [
    {
      "id": "44444444-4444-4444-8444-444444444444",
      "type": "NATIONAL_ID_FRONT",
      "status": "PENDING",
      "mimeType": "image/jpeg",
      "fileSizeBytes": 204800,
      "rejectionNote": null,
      "reviewedAt": null,
      "expiresAt": null,
      "uploadedAt": "2026-11-21T12:00:00.000Z",
      "updatedAt": "2026-11-21T12:00:00.000Z",
      "supersededAt": null,
      "supersededByDocumentId": null
    }
  ]
}
```

The document list contains metadata only; the file key and storage URL are not exposed.

### Update Merchant Profile — `PATCH /v1/merchants/profile`

Updates editable profile fields while the profile is `PENDING_SUBMISSION` or `REJECTED`. Every field is optional. `businessType` accepts `INDIVIDUAL`, `SOLE_TRADER`, `PARTNERSHIP`, `LIMITED_COMPANY`, or `NGO`.

**Input — JSON:**

```json
{
  "businessName": "Banda Farms",
  "tradingName": "Banda Fresh Produce",
  "businessType": "SOLE_TRADER",
  "businessRegistrationNo": "BR-2024-1187",
  "taxIdentificationNo": "TIN-3098765",
  "merchantCategoryCode": "5411",
  "industryDescription": "Fresh produce retail",
  "supportEmail": "support@bandafarms.mw",
  "supportPhone": "+265991234567",
  "websiteUrl": "https://bandafarms.mw",
  "addressLine1": "Plot 45, Area 47",
  "addressLine2": null,
  "city": "Lilongwe",
  "district": "Lilongwe"
}
```

**Successful response — `200`:** the updated profile record, with the profile fields shown in **Get Merchant Profile**, but without the `documents` relation.

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "merchantId": "11111111-1111-4111-8111-111111111111",
  "businessName": "Banda Farms",
  "tradingName": "Banda Fresh Produce",
  "businessType": "SOLE_TRADER",
  "businessRegistrationNo": "BR-2024-1187",
  "taxIdentificationNo": "TIN-3098765",
  "merchantCategoryCode": "5411",
  "industryDescription": "Fresh produce retail",
  "supportEmail": "support@bandafarms.mw",
  "supportPhone": "+265991234567",
  "websiteUrl": "https://bandafarms.mw",
  "addressLine1": "Plot 45, Area 47",
  "addressLine2": null,
  "city": "Lilongwe",
  "district": "Lilongwe",
  "country": "MW",
  "logoUrl": null,
  "accountStatus": "PENDING_SUBMISSION",
  "rejectionReason": null,
  "submittedAt": null,
  "approvedAt": null,
  "approvedById": null,
  "createdAt": "2026-11-21T12:00:00.000Z",
  "updatedAt": "2026-11-21T12:00:00.000Z"
}
```

### Submit Merchant Profile — `POST /v1/merchants/profile/submit`

Submits a complete profile for admin review. Requires a business name, business type, and all required current documents for that business type. Allowed from `PENDING_SUBMISSION` or `REJECTED`.

**Input:** no body.

**Successful response — `201`:**

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "merchantId": "11111111-1111-4111-8111-111111111111",
  "businessName": "Banda Farms",
  "tradingName": "Banda Fresh Produce",
  "businessType": "SOLE_TRADER",
  "businessRegistrationNo": "BR-2024-1187",
  "taxIdentificationNo": "TIN-3098765",
  "merchantCategoryCode": "5411",
  "industryDescription": "Fresh produce retail",
  "supportEmail": "support@bandafarms.mw",
  "supportPhone": "+265991234567",
  "websiteUrl": "https://bandafarms.mw",
  "addressLine1": "Plot 45, Area 47",
  "addressLine2": null,
  "city": "Lilongwe",
  "district": "Lilongwe",
  "country": "MW",
  "logoUrl": null,
  "accountStatus": "SUBMITTED",
  "rejectionReason": null,
  "submittedAt": "2026-11-21T12:00:00.000Z",
  "approvedAt": null,
  "approvedById": null,
  "createdAt": "2026-11-20T12:00:00.000Z",
  "updatedAt": "2026-11-21T12:00:00.000Z"
}
```

### Request Document Upload URL — `POST /v1/merchants/documents/upload-url`

Creates a short-lived signed URL for uploading a KYC document directly to R2. Allowed while the profile is `PENDING_SUBMISSION` or `REJECTED`. The `type` must be one of `NATIONAL_ID_FRONT`, `NATIONAL_ID_BACK`, `BUSINESS_REGISTRATION`, `TAX_CERTIFICATE`, `PROOF_OF_ADDRESS`, or `DIRECTOR_ID`. Supported content types are PDF, JPEG, and PNG.

**Input — JSON:**

```json
{
  "type": "NATIONAL_ID_FRONT",
  "contentType": "image/jpeg"
}
```

**Successful response — `201`:**

```json
{
  "uploadId": "55555555-5555-4555-8555-555555555555",
  "uploadUrl": "https://storage.example.invalid/presigned-upload-url",
  "method": "PUT",
  "contentType": "image/jpeg",
  "expiresAt": "2026-11-21T12:05:00.000Z",
  "maxFileSizeBytes": 10485760
}
```

Use the returned `uploadUrl`, `method`, and `contentType` for the next request. The URL expires after five minutes.

### Upload Document to R2 — `PUT {{uploadUrl}}`

Uploads the document bytes to the signed storage URL from Request Document Upload URL. This is an object-storage request, not a Solaris `/v1` route; it uses the presigned URL and does not need a merchant JWT.

**Input:** raw file bytes; set `Content-Type` to the same value used when requesting the URL. The collection includes a file placeholder `./replace-with-document.jpg`; select a real local document before running it. Maximum size is 10 MiB.

**Successful response:** the storage provider's successful PUT response (normally `200` with no JSON response body). Solaris does not wrap this response. After success, call Complete Document Upload with the returned `uploadId`.

### Complete Document Upload — `POST /v1/merchants/documents/:uploadId/complete`

Validates the uploaded object’s size, MIME type, and file signature, then creates the merchant document record. The upload must exist, belong to the merchant, and not be expired or completed.

**Input:** no body. Set the path parameter `uploadId` to the value returned by Request Document Upload URL.

**Successful response — `201`:**

```json
{
  "id": "44444444-4444-4444-8444-444444444444",
  "type": "NATIONAL_ID_FRONT",
  "status": "PENDING",
  "mimeType": "image/jpeg",
  "fileSizeBytes": 204800,
  "uploadedAt": "2026-11-21T12:00:00.000Z"
}
```

### List Merchant Documents — `GET /v1/merchants/documents`

Returns the merchant’s document metadata, newest upload first. Storage keys and file URLs are not returned.

**Input:** no body.

**Successful response — `200`:**

```json
[
  {
    "id": "44444444-4444-4444-8444-444444444444",
    "type": "NATIONAL_ID_FRONT",
    "status": "PENDING",
    "mimeType": "image/jpeg",
    "fileSizeBytes": 204800,
    "uploadedAt": "2026-11-21T12:00:00.000Z",
    "updatedAt": "2026-11-21T12:00:00.000Z",
    "rejectionNote": null,
    "reviewedAt": null,
    "supersededAt": null,
    "supersededByDocumentId": null,
    "isCurrent": true
  }
]
```

## Payments and checkout

### Create MWK Transaction — `POST /v1/transactions`

Creates an MWK-denominated payment and a hosted checkout session. Requires a merchant session, an approved merchant profile, and an `Idempotency-Key` header. `amountTambala` is an integer; 100 tambala equals MWK 1. The customer selects a mobile-money provider at checkout.

**Input — header and JSON:**

```http
Idempotency-Key: solaris-test-001
Content-Type: application/json
```

```json
{
  "amountTambala": 15000,
  "customerPhone": "+265991234567",
  "description": "Solaris TEST provider integration",
  "merchantReference": "TEST-001"
}
```

`paymentType` may be omitted for MWK; it defaults to `MWK`. Do not send crypto fields with an MWK transaction.

**Successful response — `201`:**

```json
{
  "publicReference": "sp_0123456789abcdef0123456789abcdef",
  "status": "CREATED",
  "amountTambala": 15000,
  "currency": "MWK",
  "checkout_url": "https://checkout.example.mw/checkout/example-token",
  "expires_at": "2026-11-21T12:30:00.000Z"
}
```

The `Idempotency-Key` is scoped to the merchant. Repeating the same key and same request returns the existing transaction/session; reusing the key with different payment details returns `409`. If the existing session is no longer available, the response has `checkout_url` and `expires_at` set to `null`.

### Create Crypto Transaction — `POST /v1/transactions`

Creates a crypto-denominated transaction and a hosted checkout session. Requires a merchant session, an approved merchant profile, and an `Idempotency-Key` header. The merchant-supplied `amount` is already denominated in the selected cryptocurrency; it is not converted from MWK. The `asset`/`network` pair must be supported by the NOWPayments mapping.

**Input — header and JSON:**

```http
Idempotency-Key: solaris-crypto-example-001
Content-Type: application/json
```

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

`amount` must be a positive decimal string with at most 18 fractional digits. `asset` is required. `network` is optional only when the mapped asset does not need a network disambiguation. Do not send `amountTambala`.

**Successful response — `201`:**

```json
{
  "publicReference": "sp_0123456789abcdef0123456789abcdef",
  "status": "CREATED",
  "paymentType": "CRYPTO",
  "provider": "NOWPAYMENTS",
  "asset": "USDT",
  "network": "TRC20",
  "amount": "25.75",
  "checkout_url": "https://checkout.example.mw/checkout/example-token",
  "expires_at": "2026-11-21T12:30:00.000Z"
}
```

### Get Transaction — `GET /v1/transactions/:reference`

Returns the transaction belonging to the authenticated merchant. The path value is the `publicReference` from transaction creation, not the database UUID.

**Input:** no body; set `reference` to the transaction's public reference.

**Successful MWK response — `200`:**

```json
{
  "publicReference": "sp_0123456789abcdef0123456789abcdef",
  "amountTambala": 15000,
  "currency": "MWK",
  "status": "PROCESSING",
  "provider": "TEST",
  "description": "Solaris TEST provider integration",
  "merchantReference": "TEST-001",
  "createdAt": "2026-11-21T12:00:00.000Z",
  "processedAt": null
}
```

For crypto, the response uses `paymentType`, `provider`, `asset`, `network`, and decimal-string `amount` instead of `amountTambala` and `currency`:

```json
{
  "publicReference": "sp_0123456789abcdef0123456789abcdef",
  "paymentType": "CRYPTO",
  "provider": "NOWPAYMENTS",
  "asset": "USDT",
  "network": "TRC20",
  "amount": "25.75",
  "status": "PROCESSING",
  "description": "Order INV-2048",
  "merchantReference": "INV-2048",
  "createdAt": "2026-11-21T12:00:00.000Z",
  "processedAt": null
}
```

### Get Checkout Session — `GET /v1/checkout/:token`

Validates a public checkout link and returns the payment details needed to render checkout. No merchant JWT is required. The `token` is the token in the `checkout_url`.

**Input:** no body.

**Successful MWK response — `200`:**

```json
{
  "reference": "sp_0123456789abcdef0123456789abcdef",
  "status": "CREATED",
  "amountTambala": 15000,
  "currency": "MWK",
  "description": "Solaris TEST provider integration",
  "canPay": true
}
```

For a crypto transaction, the amount fields are `paymentType`, `provider`, `asset`, `network`, and `amount`:

```json
{
  "reference": "sp_0123456789abcdef0123456789abcdef",
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

### Pay for MWK Transaction — `POST /v1/checkout/:token/pay`

Starts payment for an MWK checkout using a mobile-money provider. Public checkout route; Arcjet-protected. Use `AIRTEL_MONEY`, `TN_MPAMBA`, or `TEST` as appropriate for the configured environment. For mobile-money providers, `phoneNumber` is required unless the transaction already has a customer phone. `TEST` is disabled in production.

**Input — JSON:**

```json
{
  "provider": "TEST",
  "phoneNumber": "+265991234567"
}
```

**Successful response — `201`:**

```json
{
  "reference": "sp_0123456789abcdef0123456789abcdef",
  "status": "PROCESSING",
  "provider": "TEST",
  "message": "Payment request accepted. Awaiting customer completion."
}
```

The status and message reflect the provider initiation result and can instead indicate `SUCCEEDED`, `FAILED`, or `PENDING_RECONCILIATION`.

### Pay for Crypto Transaction — `POST /v1/checkout/:token/pay`

Creates a NOWPayments invoice for a crypto checkout. Public checkout route; Arcjet-protected. No phone number is required. The payment address and exact crypto amount are only included when invoice creation is accepted.

**Input — JSON:**

```json
{
  "provider": "NOWPAYMENTS"
}
```

**Successful response when invoice instructions are present — `201`:**

```json
{
  "reference": "sp_0123456789abcdef0123456789abcdef",
  "status": "PROCESSING",
  "provider": "NOWPAYMENTS",
  "message": "Payment request accepted. Awaiting customer completion.",
  "payment_instructions": {
    "paymentAddress": "TExampleCryptoPaymentAddress",
    "payAmount": "25.75",
    "asset": "USDT",
    "network": "TRC20",
    "expiresAt": "2026-11-21T12:20:00.000Z"
  }
}
```

If NOWPayments does not return an accepted invoice result, the response still has `reference`, `status`, `provider`, and `message`, but `payment_instructions` is absent. Its absence is intentional; clients must not display an address or claim that payment is ready.

### Generic Signed Provider Callback — `POST /v1/provider-callbacks`

Accepts a signed status notification for the MWK test/provider callback flow. It is not JWT-authenticated. The backend validates `x-provider-timestamp` and `x-provider-signature` against the exact raw request body using the configured callback signing secret.

**Input — headers:**

```http
x-provider-timestamp: 1795262400000
x-provider-signature: <64-character-hex-hmac-sha256>
Content-Type: application/json
```

Generate a fresh timestamp and the matching signature from the exact serialized request body using the callback secret configured for the backend. Do not use the placeholders literally.

**Input — JSON:**

```json
{
  "event": "payment.updated",
  "providerReference": "test-provider-reference-001",
  "transactionReference": "sp_0123456789abcdef0123456789abcdef",
  "attemptReference": "66666666-6666-4666-8666-666666666666",
  "amount": 150.00,
  "currency": "MWK",
  "provider": "TEST",
  "status": "SUCCESSFUL",
  "occurredAt": "2026-11-21T12:00:00.000Z"
}
```

Optional failure fields are `failureCode` and `failureMessage`. `status` must be `SUCCESSFUL` or `FAILED`.

**Successful response — `200`:**

```json
{
  "received": true,
  "duplicate": false
}
```

An identical repeat callback returns `duplicate: true`.

### NOWPayments IPN — `POST /v1/provider-callbacks/nowpayments`

Receives a NOWPayments IPN and updates the crypto payment. It is signature-verified, not JWT-authenticated. Supply the `x-nowpayments-sig` header using NOWPayments' IPN secret; the backend verifies the sorted-key JSON HMAC-SHA512 signature. This route accepts the supported payload fields `payment_id` and `payment_status`, with optional `actually_paid`, `pay_amount`, and `order_id`.

**Input — headers:**

```http
x-nowpayments-sig: <hex-hmac-sha512-signature>
Content-Type: application/json
```

**Input — JSON:**

```json
{
  "payment_id": "nowpayments-payment-id",
  "payment_status": "finished",
  "actually_paid": "25.75",
  "pay_amount": "25.75",
  "order_id": "66666666-6666-4666-8666-666666666666"
}
```

`payment_status` must be one of `waiting`, `confirming`, `confirmed`, `sending`, `partially_paid`, `finished`, `failed`, `expired`, or `refunded`. Decimal amounts must be JSON strings. The signature must match the canonicalized payload; a placeholder signature will receive `401`.

**Successful response — `200`:**

```json
{
  "received": true,
  "duplicate": false
}
```

Duplicate IPNs are acknowledged with `duplicate: true`.

## Admin — merchant applications

All routes in this section require an admin session and one of the `SUPER_ADMIN` or `COMPLIANCE` roles.

### List Merchant Applications — `GET /v1/admin/merchant-applications`

Lists applications in `SUBMITTED` or `UNDER_REVIEW` state. Supports `page` (default `1`) and `limit` (default `20`, maximum `100`).

**Input — query:**

```text
?page=1&limit=20
```

**Successful response — `200`:**

```json
{
  "data": [
    {
      "id": "33333333-3333-4333-8333-333333333333",
      "businessName": "Banda Farms",
      "businessType": "SOLE_TRADER",
      "accountStatus": "SUBMITTED",
      "submittedAt": "2026-11-21T12:00:00.000Z",
      "createdAt": "2026-11-20T12:00:00.000Z",
      "merchant": {
        "id": "11111111-1111-4111-8111-111111111111",
        "name": "Jane Banda",
        "email": "jane@example.com",
        "phone": "+265991234577"
      },
      "_count": {
        "documents": 2
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

### Get Merchant Application — `GET /v1/admin/merchant-applications/:profileId`

Returns a full profile, merchant identity, document metadata, and review history for the selected profile.

**Input:** no body; set `profileId` to a merchant profile UUID.

**Successful response — `200`:** profile fields match **Get Merchant Profile**, with these additional relations:

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "merchantId": "11111111-1111-4111-8111-111111111111",
  "businessName": "Banda Farms",
  "businessType": "SOLE_TRADER",
  "accountStatus": "SUBMITTED",
  "merchant": {
    "id": "11111111-1111-4111-8111-111111111111",
    "name": "Jane Banda",
    "email": "jane@example.com",
    "phone": "+265991234577"
  },
  "documents": [
    {
      "id": "44444444-4444-4444-8444-444444444444",
      "type": "NATIONAL_ID_FRONT",
      "status": "PENDING",
      "mimeType": "image/jpeg",
      "fileSizeBytes": 204800,
      "rejectionNote": null,
      "reviewedAt": null,
      "expiresAt": null,
      "uploadedAt": "2026-11-21T12:00:00.000Z",
      "supersededAt": null,
      "supersededByDocumentId": null
    }
  ],
  "reviewHistory": [
    {
      "id": "77777777-7777-4777-8777-777777777777",
      "profileId": "33333333-3333-4333-8333-333333333333",
      "fromStatus": "PENDING_SUBMISSION",
      "toStatus": "SUBMITTED",
      "note": null,
      "actorType": "MERCHANT",
      "actorId": "11111111-1111-4111-8111-111111111111",
      "createdAt": "2026-11-21T12:00:00.000Z"
    }
  ]
}
```

The profile record also includes its remaining scalar fields, as listed in Get Merchant Profile.

### Start Merchant Application Review — `POST /v1/admin/merchant-applications/:profileId/start-review`

Moves a `SUBMITTED` application to `UNDER_REVIEW` and records the admin action.

**Input:** no body.

**Successful response — `201`:**

```json
{
  "profileId": "33333333-3333-4333-8333-333333333333",
  "accountStatus": "UNDER_REVIEW",
  "message": "Merchant application review started."
}
```

### Approve Merchant Application — `POST /v1/admin/merchant-applications/:profileId/approve`

Approves an application in `UNDER_REVIEW` only when required documents are approved and current. A failed document check returns `400` with a `documents` field describing what needs attention.

**Input:** no body.

**Successful response — `201`:**

```json
{
  "profileId": "33333333-3333-4333-8333-333333333333",
  "accountStatus": "APPROVED",
  "message": "Merchant application approved."
}
```

### Reject Merchant Application — `POST /v1/admin/merchant-applications/:profileId/reject`

Rejects an application in `UNDER_REVIEW`. `reason` is required, must not be blank, and may be at most 1,000 characters.

**Input — JSON:**

```json
{
  "reason": "Business registration document is invalid."
}
```

**Successful response — `201`:**

```json
{
  "profileId": "33333333-3333-4333-8333-333333333333",
  "accountStatus": "REJECTED",
  "rejectionReason": "Business registration document is invalid.",
  "message": "Merchant application rejected."
}
```

### Preview Merchant Document — `GET /v1/admin/merchant-applications/:profileId/documents/:documentId/preview`

Creates a signed download URL for a document belonging to the selected application. Requires the admin session and `SUPER_ADMIN` or `COMPLIANCE` role.

**Input:** no body; provide the profile and document UUIDs in the path.

**Successful response — `200`:**

```json
{
  "document": {
    "id": "44444444-4444-4444-8444-444444444444",
    "type": "NATIONAL_ID_FRONT",
    "status": "PENDING",
    "mimeType": "image/jpeg",
    "fileSizeBytes": 204800
  },
  "previewUrl": "https://storage.example.invalid/presigned-download-url",
  "expiresInSeconds": 300
}
```

## Admin — settlements

All settlement endpoints require an admin session. Import, reconcile, and allocation require the `OPERATIONS` role. Approve and post require `SUPER_ADMIN`.

**Important response limitation:** these handlers return Prisma records containing JavaScript `BigInt` values (for example, tambala amounts). No BigInt-to-JSON serializer is configured in the current backend source. Standard Express JSON serialization does not support raw BigInt values, so these endpoints may fail while producing an HTTP JSON response. The templates below show the returned record fields and represent BigInt amounts as decimal strings for readability; the backend does not currently perform that conversion.

### Import Provider Settlement — `POST /v1/admin/settlements/provider-imports/normalized`

Imports a normalized provider report and creates or reuses its settlement batch. `sourceFileChecksum` must be a 64-character SHA-256 hex digest. `grossAmountTambala` must equal provider fee plus expected net. Report and item amounts are tambala integers; `rawRecord` preserves the source row.

**Input — JSON:**

```json
{
  "provider": "TEST",
  "providerAccountReference": "test-provider-account",
  "sourceFileName": "test-settlement-2026-11-21.csv",
  "sourceFileChecksum": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "sourceObjectKey": "settlements/test-settlement-2026-11-21.csv",
  "formatIdentifier": "test-normalized-v1",
  "providerBatchReference": "test-batch-2026-11-21",
  "currency": "MWK",
  "reportPeriodStart": "2026-11-21T00:00:00.000Z",
  "reportPeriodEnd": "2026-11-21T23:59:59.999Z",
  "grossAmountTambala": 12000,
  "providerFeeAmountTambala": 200,
  "expectedNetAmountTambala": 11800,
  "items": [
    {
      "sourceRowIdentity": "row-1",
      "providerRecordReference": "record-1",
      "providerPaymentReference": "test-provider-reference-001",
      "recordKind": "PAYMENT",
      "reportedStatus": "SUCCESS",
      "settlementConfirmed": true,
      "grossAmountTambala": 12000,
      "providerFeeAmountTambala": 200,
      "currency": "MWK",
      "rawRecord": {
        "providerReference": "test-provider-reference-001",
        "grossTambala": 12000,
        "feeTambala": 200
      }
    }
  ]
}
```

**Successful service result — normally `201`:** an object containing `import` and `batch`. A repeated source checksum can return the existing records.

```json
{
  "import": {
    "id": "88888888-8888-4888-8888-888888888888",
    "provider": "TEST",
    "providerAccountReference": "test-provider-account",
    "sourceFileName": "test-settlement-2026-11-21.csv",
    "sourceFileChecksum": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "sourceObjectKey": "settlements/test-settlement-2026-11-21.csv",
    "formatIdentifier": "test-normalized-v1",
    "status": "IMPORTED",
    "importedById": "22222222-2222-4222-8222-222222222222",
    "importedAt": "2026-11-21T12:00:00.000Z",
    "validationErrors": null
  },
  "batch": {
    "id": "99999999-9999-4999-8999-999999999999",
    "importId": "88888888-8888-4888-8888-888888888888",
    "provider": "TEST",
    "providerAccountReference": "test-provider-account",
    "providerBatchReference": "test-batch-2026-11-21",
    "currency": "MWK",
    "grossAmountTambala": "12000",
    "providerFeeAmountTambala": "200",
    "expectedNetAmountTambala": "11800",
    "status": "IMPORTED",
    "createdAt": "2026-11-21T12:00:00.000Z",
    "updatedAt": "2026-11-21T12:00:00.000Z"
  }
}
```

### Import Bank Statement — `POST /v1/admin/settlements/bank-statements/normalized`

Imports normalized bank statement lines for a known bank account. `sourceFileChecksum` must be a 64-character SHA-256 hex digest. Amounts are tambala integers; each line requires a transaction date and raw source record.

**Input — JSON:**

```json
{
  "bankAccountId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "sourceFileName": "bank-statement-2026-11-21.csv",
  "sourceFileChecksum": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "sourceObjectKey": "bank-statements/bank-statement-2026-11-21.csv",
  "formatIdentifier": "bank-normalized-v1",
  "statementPeriodStart": "2026-11-21T00:00:00.000Z",
  "statementPeriodEnd": "2026-11-21T23:59:59.999Z",
  "lines": [
    {
      "sourceRowIdentity": "bank-row-1",
      "bankReference": "BANK-REF-001",
      "description": "Test provider settlement",
      "transactionDate": "2026-11-21T12:00:00.000Z",
      "valueDate": "2026-11-21T12:00:00.000Z",
      "creditAmountTambala": 11800,
      "debitAmountTambala": 0,
      "currency": "MWK",
      "rawRecord": {
        "reference": "BANK-REF-001",
        "creditTambala": 11800
      }
    }
  ]
}
```

**Successful service result — normally `201`:** the created or previously imported bank statement import record. The endpoint does not return its `lines` relation.

```json
{
  "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "bankAccountId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "sourceFileName": "bank-statement-2026-11-21.csv",
  "sourceFileChecksum": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "sourceObjectKey": "bank-statements/bank-statement-2026-11-21.csv",
  "formatIdentifier": "bank-normalized-v1",
  "statementPeriodStart": "2026-11-21T00:00:00.000Z",
  "statementPeriodEnd": "2026-11-21T23:59:59.999Z",
  "status": "IMPORTED",
  "importedById": "22222222-2222-4222-8222-222222222222",
  "importedAt": "2026-11-21T12:00:00.000Z",
  "validationErrors": null
}
```

### Reconcile Provider Batch — `POST /v1/admin/settlements/:batchId/reconcile`

Matches settlement payment items to successful MWK transactions and updates the batch state. Requires an operations admin.

**Input:** no body; set `batchId` to a provider settlement batch UUID.

**Successful service result — normally `201`:** the updated provider settlement batch record.

```json
{
  "id": "99999999-9999-4999-8999-999999999999",
  "importId": "88888888-8888-4888-8888-888888888888",
  "provider": "TEST",
  "providerAccountReference": "test-provider-account",
  "providerBatchReference": "test-batch-2026-11-21",
  "currency": "MWK",
  "grossAmountTambala": "12000",
  "providerFeeAmountTambala": "200",
  "expectedNetAmountTambala": "11800",
  "status": "VALIDATED",
  "validationErrors": null,
  "approvedAt": null,
  "approvedById": null,
  "postedAt": null,
  "ledgerTransactionId": null,
  "createdAt": "2026-11-21T12:00:00.000Z",
  "updatedAt": "2026-11-21T12:01:00.000Z"
}
```

### Allocate Bank Credit — `POST /v1/admin/settlements/allocations`

Allocates part of a valid bank credit line to a settlement batch. The `idempotencyKey` prevents duplicate allocation requests. Requires an operations admin.

**Input — JSON:**

```json
{
  "batchId": "99999999-9999-4999-8999-999999999999",
  "bankStatementLineId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "amountTambala": 11800,
  "idempotencyKey": "bank-credit-allocation-example-001"
}
```

**Successful service result — normally `201`:**

```json
{
  "id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "batchId": "99999999-9999-4999-8999-999999999999",
  "bankStatementLineId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "amountTambala": "11800",
  "idempotencyKey": "bank-credit-allocation-example-001",
  "status": "ACTIVE",
  "allocatedById": "22222222-2222-4222-8222-222222222222",
  "reversedById": null,
  "reversedAt": null,
  "reversalReason": null,
  "createdAt": "2026-11-21T12:05:00.000Z"
}
```

### Approve Provider Batch — `POST /v1/admin/settlements/:batchId/approve`

Approves a fully reconciled batch whose items and bank allocations pass validation. Requires a `SUPER_ADMIN`; an admin who performed reconciliation or allocation cannot approve that work.

**Input:** no body.

**Successful service result — normally `201`:** the updated provider settlement batch record, with `status: "APPROVED"` and its approval timestamp/admin ID. Its other fields match the Reconcile Provider Batch response.

```json
{
  "id": "99999999-9999-4999-8999-999999999999",
  "importId": "88888888-8888-4888-8888-888888888888",
  "provider": "TEST",
  "providerAccountReference": "test-provider-account",
  "providerBatchReference": "test-batch-2026-11-21",
  "currency": "MWK",
  "grossAmountTambala": "12000",
  "providerFeeAmountTambala": "200",
  "expectedNetAmountTambala": "11800",
  "status": "APPROVED",
  "validationErrors": null,
  "approvedAt": "2026-11-21T12:10:00.000Z",
  "approvedById": "22222222-2222-4222-8222-222222222222",
  "postedAt": null,
  "ledgerTransactionId": null,
  "createdAt": "2026-11-21T12:00:00.000Z",
  "updatedAt": "2026-11-21T12:10:00.000Z"
}
```

### Post Provider Batch — `POST /v1/admin/settlements/:batchId/post`

Posts an approved settlement batch to the ledger. Requires a `SUPER_ADMIN`; an admin who approved or reconciled the batch cannot post it. Repeating a request for a batch already in `POSTED` state returns that batch.

**Input:** no body.

**Successful service result — normally `201`:** the updated provider settlement batch record, with `status: "POSTED"`, `postedAt`, and `ledgerTransactionId`. Its other fields match the Reconcile Provider Batch response.

```json
{
  "id": "99999999-9999-4999-8999-999999999999",
  "importId": "88888888-8888-4888-8888-888888888888",
  "provider": "TEST",
  "providerAccountReference": "test-provider-account",
  "providerBatchReference": "test-batch-2026-11-21",
  "currency": "MWK",
  "grossAmountTambala": "12000",
  "providerFeeAmountTambala": "200",
  "expectedNetAmountTambala": "11800",
  "status": "POSTED",
  "validationErrors": null,
  "approvedAt": "2026-11-21T12:10:00.000Z",
  "approvedById": "22222222-2222-4222-8222-222222222222",
  "postedAt": "2026-11-21T12:15:00.000Z",
  "ledgerTransactionId": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  "createdAt": "2026-11-21T12:00:00.000Z",
  "updatedAt": "2026-11-21T12:15:00.000Z"
}
```

## Collection variables

The **Smartpay** Bruno environment contains:

| Variable | Purpose |
|---|---|
| `baseUrl` | API origin, without `/v1` |
| `profileId` | Merchant profile UUID for admin application requests |
| `documentId` | Merchant document UUID |
| `uploadId` | Signed upload intent UUID |
| `uploadUrl` | Presigned R2 URL returned by Request Document Upload URL |
| `checkoutToken` | Token from the hosted checkout URL |
| `publicReference` | Transaction public reference |
| `attemptId` | Payment attempt UUID for the generic callback example |
| `callbackTimestamp` | Fresh epoch-millisecond timestamp for generic callback signing |
| `callbackSignature` | HMAC-SHA256 signature for the exact generic callback body |
| `nowPaymentsSignature` | NOWPayments IPN HMAC-SHA512 signature |
| `nowPaymentsPaymentId` | NOWPayments payment ID from the payment attempt |
| `bankAccountId` | Existing bank account UUID for statement import |
| `batchId` | Provider settlement batch UUID |
| `bankStatementLineId` | Imported bank statement line UUID |

Replace `replace-with-*` values with values from your environment before sending requests. Do not commit credentials, OTPs, cookies, signing secrets, or live payment data.

## Response and integration notes

- The callback responses acknowledge receipt; they do not contain the updated transaction. Fetch the transaction using `GET /v1/transactions/:reference` to read its current status.
- NOWPayments crypto initiation is asynchronous. A response with `payment_instructions` means the customer can pay the returned `payAmount` to the returned `paymentAddress`; the eventual status arrives through the IPN.
- For crypto transactions, the amount is input in the selected cryptocurrency. The merchant balance is credited in that cryptocurrency after successful payment; MWK is not used to calculate the crypto payment amount.
- Do not infer success solely from an initiation response. Read the returned status and follow subsequent callback updates.
- The settlement endpoints currently return records containing raw BigInt values; see the serialization limitation in the Settlements section before integrating against their response bodies.

## Related backend documentation

The following implementation and API-contract documents provide additional detail for each collection area:

| Collection area | Backend documentation |
|---|---|
| All routes and response contracts | [API Reference](../../docs/architecture/apiReference.md) |
| Merchant authentication and cookies | [Authentication Contract](../../docs/architecture/authContract.md) |
| Admin authentication and roles | [Admin Authentication Module](../../docs/architecture/AdminAuthModule.md) |
| Merchant profiles and KYC | [Merchant Module](../../docs/architecture/merchantModule.md) · [Storage Module](../../docs/architecture/storageModule.md) |
| Transactions, checkout, and callbacks | [Transactions Module](../../docs/architecture/transactionsModule.md) |
| NOWPayments crypto payments and IPNs | [NOWPayments Integration](../../docs/architecture/nowpaymentsIntegration.md) · [NOWPayments Adapter](../../docs/architecture/nowpaymentsAdapter.md) |
| Merchant application review | [Admin Module](../../docs/architecture/adminModule.md) |
| Settlement workflows and ledger posting | [Ledger Module](../../docs/architecture/ledgerModule.md) |

## Troubleshooting

| Result | Check |
|---|---|
| Connection refused or timeout | Confirm the backend is running and `baseUrl` is the correct origin. |
| `400 Bad Request` | Check required fields, enums, decimal-string formats, allowed content types, and unknown properties. |
| `401 Unauthorized` | Sign in through the correct merchant/admin flow, retain the corresponding cookie, or verify callback headers and signatures. |
| `403 Forbidden` | Check merchant approval state and the admin role required for the endpoint. |
| `404 Not Found` | Check the `/v1` prefix and the resource ID, reference, or checkout token. |
| `409 Conflict` | Check idempotency-key reuse, transaction state, and application/settlement workflow state. |
| Upload completion fails | Use the unexpired presigned URL, matching `Content-Type`, a supported file signature, and a file no larger than 10 MiB. |
| OTP email is missing | Check email-provider configuration and development logs; use the resend request after its cooldown. |

Use development accounts and data. Delete Account is destructive from the merchant's perspective, and payment/callback requests should only be tested in an environment and with credentials you are authorized to use.
