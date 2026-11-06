# Merchants Module

## 1. Overview

The `merchants` module manages merchant business profiles, KYC document uploads, and the application review workflow for Solaris Malawi.

It allows authenticated merchants to:

- Retrieve their business profile and uploaded document records.
- Update their business details while preparing an application.
- Request pre-signed direct-to-cloud upload URLs for KYC documents.
- Finalize uploaded documents with automatic size, MIME type, and magic-byte signature validation.
- List all uploaded documents with current active versus superseded status.
- Submit their application for administrative compliance review.
- Correct and resubmit an application after rejection.

The module is built with NestJS, Prisma, and PostgreSQL, and integrates with `StorageModule` (Cloudflare R2 via the S3-compatible API). It relies on merchant JWT authentication to identify the caller.

## 2. Responsibilities

The module is responsible for:

- Retrieving the authenticated merchant's profile.
- Updating editable business profile fields.
- Enforcing profile status restrictions (`PENDING_SUBMISSION` or `REJECTED` for edits and uploads).
- Generating short-lived (5-minute) pre-signed upload URLs for Cloudflare R2.
- Verifying uploaded file size (0 < size <= 10 MiB) and MIME type.
- Inspecting binary magic-byte signatures (PDF, PNG, JPEG) to prevent malicious file uploads.
- Automatically superseding earlier document versions of the same type while retaining full audit records.
- Checking required document types before submission.
- Validating business name and business type.
- Transitioning eligible profiles to `SUBMITTED`.
- Recording profile status transitions in `MerchantReviewHistory`.
- Using database transactions to guarantee consistency between application updates, documents, and audit logs.

Administrator review, approval, rejection, and document preview are handled by the separate `admin` module.

## 3. Endpoints

All endpoints use the `/v1` API prefix and require merchant authentication through `JwtAuthGuard`.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/v1/merchants/profile` | Retrieve the current merchant's profile and documents |
| PATCH | `/v1/merchants/profile` | Update editable profile details |
| POST | `/v1/merchants/profile/submit` | Submit the application for review |
| POST | `/v1/merchants/documents/upload-url` | Request a pre-signed Cloudflare R2 upload URL |
| POST | `/v1/merchants/documents/:uploadId/complete` | Complete and validate an uploaded KYC document |
| GET | `/v1/merchants/documents` | List all uploaded documents for the merchant |

The controller obtains the merchant ID through `@CurrentUser('userId')`. The client does not need to send a merchant ID in the request body or URL.

### 3.1 Get Merchant Profile

**Endpoint**

`GET {{baseUrl}}/v1/merchants/profile`

**Request body:** None.

**Authentication:** Required.

**Purpose**

Retrieves the authenticated merchant's profile, including its associated document records.

**Successful response — HTTP 200**

The returned profile includes fields from the `MerchantProfile` database model and a `documents` array.

The exact fields depend on the Prisma schema and the records in the database. For example, the response may include:

```json
{
  "merchantId": "merchant-uuid",
  "businessName": "Example Trading",
  "businessType": "SOLE_TRADER",
  "accountStatus": "PENDING_SUBMISSION",
  "documents": []
}
```

This is an illustrative response, not a guarantee of the exact field set or values.

If no profile exists, the service returns HTTP 404 Not Found.

### 3.2 Update Merchant Profile

**Endpoint**

`PATCH {{baseUrl}}/v1/merchants/profile`

**Request headers**

`Content-Type: application/json`

**Request body**

The request must contain fields accepted by `UpdateProfileDto`. For example, assuming these fields are permitted by the DTO:

```json
{
  "businessName": "Example Trading",
  "businessType": "SOLE_TRADER"
}
```

Only send fields supported by the actual DTO and its validation rules.

**Purpose**

Updates the authenticated merchant's editable profile fields.

**Profile status restrictions**

Profile updates are permitted only when the application is in one of these states:

- `PENDING_SUBMISSION`
- `REJECTED`

Updates are rejected for profiles in other states. Merchants cannot use this endpoint to change approval-related fields such as `accountStatus`, `approvedAt`, or `approvedById`.

**Possible responses**

- `200 OK` — profile updated.
- `400 Bad Request` — profile status does not permit editing, or the DTO fails validation.
- `401 Unauthorized` — authentication is missing or invalid.
- `404 Not Found` — profile does not exist.

### 3.3 Submit Merchant Application

**Endpoint**

`POST {{baseUrl}}/v1/merchants/profile/submit`

**Request body:** None.

**Authentication:** Required.

**Purpose**

Validates the merchant's profile and document records, then submits the application for administrative review.

**Submission requirements**

Before submission, the service verifies that:

1. A profile exists.
2. The profile status is `PENDING_SUBMISSION` or `REJECTED`.
3. A business type has been selected.
4. A non-empty business name has been provided.
5. Required document types have been uploaded and have not been rejected or expired.
6. Required documents have not passed their recorded expiry dates.

Pending documents may satisfy the initial submission check. They do not automatically qualify for application approval: administrators must verify the documents as part of the review workflow.

**Successful response — HTTP 200**

The service returns the updated profile after changing its status to `SUBMITTED`.

**Status transitions**

```text
PENDING_SUBMISSION ──> SUBMITTED

REJECTED ────────────> SUBMITTED
```

During the transaction, the service:

1. Conditionally updates the profile status.
2. Sets `submittedAt`.
3. Clears the previous `rejectionReason`.
4. Creates a `MerchantReviewHistory` entry.
5. Returns the updated profile.

If the status changes before the update succeeds, the operation is rejected rather than silently overwriting the competing change.

### 3.4 Request Document Upload URL

**Endpoint**

`POST {{baseUrl}}/v1/merchants/documents/upload-url`

**Request headers**

`Content-Type: application/json`

**Request body** (`RequestDocumentUploadDto`)

```json
{
  "type": "BUSINESS_REGISTRATION",
  "contentType": "application/pdf"
}
```

- `type`: One of the valid `DocumentType` enum values (e.g. `NATIONAL_ID_FRONT`, `NATIONAL_ID_BACK`, `BUSINESS_REGISTRATION`, `TAX_CERTIFICATE`, `PROOF_OF_ADDRESS`, `DIRECTOR_ID`).
- `contentType`: Allowed formats are `application/pdf`, `image/jpeg`, and `image/png`.

**Profile status restrictions**

Uploads are only permitted when `accountStatus` is `PENDING_SUBMISSION` or `REJECTED`. Attempting to request an upload URL while the application is `SUBMITTED`, `UNDER_REVIEW`, or `APPROVED` returns HTTP 400 Bad Request.

**Successful response — HTTP 201 Created**

```json
{
  "uploadId": "3b29c97b-9e4a-4a6f-99f5-e64e5c8e3325",
  "uploadUrl": "https://<account-id>.r2.cloudflarestorage.com/solaris-kyc-documents/kyc/...",
  "method": "PUT",
  "contentType": "application/pdf",
  "expiresAt": "2026-10-28T02:00:00.000Z",
  "maxFileSizeBytes": 10485760
}
```

The returned `uploadUrl` is a pre-signed S3 `PutObjectCommand` URL valid for **5 minutes**. The merchant client performs a direct HTTP `PUT` with the raw binary file to this URL.

### 3.5 Complete Document Upload

**Endpoint**

`POST {{baseUrl}}/v1/merchants/documents/:uploadId/complete`

**Request body:** None.

**Authentication:** Required.

**Purpose**

Finalizes the upload process after the client has uploaded the file to Cloudflare R2.

**Verification logic**

1. Verifies that the upload intent (`uploadId`) exists for the merchant's profile, has not already been completed, and has not expired.
2. Fetches object metadata from Cloudflare R2 via `HeadObjectCommand`.
3. Validates file size: must be greater than 0 and less than or equal to 10 MiB (10,485,760 bytes).
4. Validates that the uploaded `ContentType` matches the declared `expectedMimeType`.
5. Reads the first 16 bytes of the object via range request and verifies the binary magic-byte signature:
   - `application/pdf`: starts with `%PDF-` (`0x25, 0x50, 0x44, 0x46, 0x2d`)
   - `image/png`: starts with PNG header (`0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a`)
   - `image/jpeg`: starts with JPEG marker (`0xff, 0xd8, 0xff`)
6. If any validation fails, the file is immediately deleted from R2 and HTTP 400 Bad Request is returned.
7. Executes a Prisma transaction to:
   - Create a new `MerchantDocument` with status `PENDING`, internal `fileUrl` (`r2://...`), and storage `fileKey`.
   - Mark any existing active documents of the same `type` as superseded (`supersededAt: now()`, `supersededByDocumentId: document.id`).
   - Mark the `MerchantDocumentUpload` intent as completed (`completedAt: now()`).

**Successful response — HTTP 201 Created**

```json
{
  "id": "e6754bfa-f6f7-4952-b8ec-f2369680376d",
  "type": "BUSINESS_REGISTRATION",
  "status": "PENDING",
  "mimeType": "application/pdf",
  "fileSizeBytes": 245120,
  "uploadedAt": "2026-10-28T01:55:00.000Z"
}
```

### 3.6 List Merchant Documents

**Endpoint**

`GET {{baseUrl}}/v1/merchants/documents`

**Request body:** None.

**Authentication:** Required.

**Purpose**

Retrieves all uploaded documents associated with the authenticated merchant's profile, ordered by `uploadedAt` descending.

**Successful response — HTTP 200 OK**

```json
[
  {
    "id": "e6754bfa-f6f7-4952-b8ec-f2369680376d",
    "type": "BUSINESS_REGISTRATION",
    "status": "PENDING",
    "mimeType": "application/pdf",
    "fileSizeBytes": 245120,
    "uploadedAt": "2026-10-28T01:55:00.000Z",
    "updatedAt": "2026-10-28T01:55:00.000Z",
    "rejectionNote": null,
    "reviewedAt": null,
    "supersededAt": null,
    "supersededByDocumentId": null,
    "isCurrent": true
  }
]
```

The response includes the computed field `isCurrent`, which is `true` if the document is active (`supersededAt === null && supersededByDocumentId === null`) and `false` if superseded by a newer upload.

---

## 4. Business Types and Document Requirements

The document policy helper in `document-requirements.ts` defines required and optional document types for each business category.

| Business type | Required documents | Optional documents |
|---|---|---|
| `INDIVIDUAL` | National ID front and back | Tax certificate, proof of address |
| `SOLE_TRADER` | National ID front and back | Business registration, tax certificate, proof of address |
| `PARTNERSHIP` | National ID front and back, business registration | Tax certificate, proof of address, director ID |
| `LIMITED_COMPANY` | National ID front and back, business registration, tax certificate, director ID | Proof of address |
| `NGO` | National ID front and back, business registration, director ID | Tax certificate, proof of address |

The `getDocumentRequirements()` helper returns copies of the required and optional arrays to prevent callers from accidentally modifying the underlying policy.

Submission validation uses `getDocumentRequirements()` as the shared source of required document types, consistent with admin approval.

These are initial development rules, not definitive legal requirements for Malawi. Confirm the final policy with the relevant compliance and legal stakeholders before production use.

## 5. Document Validation Rules

The current submission implementation considers a document eligible for satisfying a required type when:

- Both `supersededAt` and `supersededByDocumentId` are null (i.e. `isCurrent === true`).
- Its status is not `REJECTED`.
- Its status is not `EXPIRED`.
- It has no expiry date, or its expiry date is in the future.

This means a document with status `PENDING` can satisfy the submission-stage check.

Superseded documents are excluded from submission validation, consistent with admin approval. They remain in the database for history and do not satisfy required document types.

Document integrity and format authenticity are verified at upload completion by `MerchantDocumentsService` using Cloudflare R2 object metadata and binary magic-number signatures. Direct browser access is prevented; files in storage are identified via private object keys and internal URIs.

## 6. Application Lifecycle

The merchant module supports the initial submission and resubmission stages.

```text
PENDING_SUBMISSION
        |
        | Merchant submits application
        v
    SUBMITTED
        |
        | Administrator starts review
        v
   UNDER_REVIEW
      /     \
     /       \
 APPROVED   REJECTED
                |
                | Merchant corrects application
                | and resubmits
                v
            SUBMITTED
```

The `admin` module is responsible for starting reviews, approving applications, and rejecting applications.

A merchant cannot directly set the profile status to `APPROVED` or `UNDER_REVIEW` through the profile update endpoint.

## 7. Review History and Transactions

The service creates `MerchantReviewHistory` entries when a merchant successfully submits or resubmits an application.

Each submission history entry records:

- The profile ID.
- The previous status.
- The new status.
- The actor type (`MERCHANT`).
- The actor ID.

The profile update and review-history creation occur within one Prisma transaction. This ensures that either both operations commit or both roll back if an operation fails.

The history model is also used by the admin workflow to record review, approval, and rejection transitions.

## 8. Testing with Bruno

Set your Bruno environment variable:

```text
baseUrl = http://localhost:3000
```

Adjust the value to match your running API.

### Test 1 — Retrieve Profile

- Method: `GET`
- URL: `{{baseUrl}}/v1/merchants/profile`
- Body: None.

Log in as a merchant first and ensure Bruno sends the merchant authentication cookie.

Verify that the correct merchant's profile and documents are returned.

### Test 2 — Update Profile

- Method: `PATCH`
- URL: `{{baseUrl}}/v1/merchants/profile`
- Body: JSON.

Example:

```json
{
  "businessName": "Example Trading",
  "businessType": "SOLE_TRADER"
}
```

Use a merchant whose profile is in `PENDING_SUBMISSION` or `REJECTED`, and ensure the fields are accepted by `UpdateProfileDto`.

Verify that the profile changes are persisted.

### Test 3 — Submit Application

- Method: `POST`
- URL: `{{baseUrl}}/v1/merchants/profile/submit`
- Body: None.

Before submitting, ensure that the profile has a business name, a business type, and all required document records for the current submission policy.

Verify that the status changes to `SUBMITTED` and that a corresponding review-history record is created.

### Test 4 — Submission with Missing Requirements

Attempt to submit a profile without a business type, business name, or required document.

Verify that the request fails with HTTP 400 Bad Request and that the profile status does not change.

### Test 5 — Update After Submission

Attempt to update a profile whose status is `SUBMITTED` or `UNDER_REVIEW`.

Verify that the request fails with HTTP 400 Bad Request.

### Test 6 — Resubmit a Rejected Application

Use a profile with status `REJECTED`.

1. Update the permitted business details.
2. Ensure the required document records are valid.
3. Submit the application again.
4. Verify that its status becomes `SUBMITTED`, the old rejection reason is cleared, and a new review-history entry is created.

### Test 7 — Unauthenticated Access

Call any merchant endpoint without a valid authentication cookie.

Verify that the request returns HTTP 401 Unauthorized.

### Test 8 — Document Upload Workflow

1. Call `POST /v1/merchants/documents/upload-url` with `type: "NATIONAL_ID_FRONT"` and `contentType: "application/pdf"`.
2. Extract `uploadUrl` and `uploadId`.
3. Perform an HTTP `PUT` with binary PDF data to `uploadUrl`.
4. Call `POST /v1/merchants/documents/{{uploadId}}/complete`.
5. Verify that HTTP 201 is returned with document details.
6. Call `GET /v1/merchants/documents` and verify `isCurrent: true`.
7. Upload a second `NATIONAL_ID_FRONT`. Complete the upload.
8. Call `GET /v1/merchants/documents` and verify the first document now has `isCurrent: false` (`supersededAt` populated), and the second has `isCurrent: true`.

### Test 9 — Invalid Document Upload Content

1. Request an upload URL with `contentType: "application/pdf"`.
2. Upload plain text or invalid non-PDF binary data to the pre-signed URL.
3. Call `POST /v1/merchants/documents/{{uploadId}}/complete`.
4. Verify HTTP 400 Bad Request is returned with `"The file contents do not match the declared format"`.
5. Verify the corrupted file was purged from Cloudflare R2.

## 9. Current Scope and Limitations

The module handles profile retrieval, editing, direct-to-cloud KYC document uploads with Cloudflare R2, binary magic-byte validation, document supersession, and application submission. Areas for future extension include:

- Antivirus/malware scanning pipeline on uploaded blobs.
- Merchant-facing rejection feedback workflows for specific rejected documents.
- Granular document expiry date management for merchant-supplied documents.
- A definitive, compliance-approved Malawi KYC document policy.

## 10. Summary

The `merchants` module provides the merchant business-profile and KYC submission workflow for Solaris Malawi. It manages profile updates, direct-to-cloud document uploads via pre-signed Cloudflare R2 URLs, binary signature verification, and transactional submission tracking. Administrator review, approval, and preview access remain separate responsibilities in the `admin` module.
