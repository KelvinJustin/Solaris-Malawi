# Solaris Malawi — Admin Module

## 1. Overview

The Admin module manages merchant application reviews and KYC approval decisions. It provides authorized administrators with access to merchant applications, document validation, application status transitions, and an audit trail of review decisions.

The module is implemented using NestJS and Prisma, with PostgreSQL as the database.

### Responsibilities

- Retrieve and paginate merchant applications awaiting review.
- View individual merchant applications, their documents, and review history.
- Move submitted applications into review.
- Approve applications after validating required documents.
- Reject applications with a mandatory rejection reason.
- Record status changes and administrator actions in an audit history.
- Enforce authentication and role-based access control.

### Main files

| File | Responsibility |
|---|---|
| `src/admin/admin.controller.ts` | Defines admin HTTP endpoints and delegates requests to the service. |
| `src/admin/admin.service.ts` | Implements application retrieval, status transitions, validation, and review decisions. |
| `src/admin/admin.service.spec.ts` | Tests admin service behavior using mocked database operations. |
| `src/admin/admin.controller.spec.ts` | Tests controller behavior, if present. |
| `src/admin/admin.module.ts` | Registers the admin controller, service, and imports StorageModule. |
| `src/storage/r2-storage.service.ts` | Provides pre-signed S3 download URLs for secure document inspection. |
| `src/admin-auth/admin-jwt-auth.guard.ts` | Protects routes using admin authentication. |
| `src/admin-auth/admin-roles.guard.ts` | Enforces route-level admin role restrictions. |
| `src/admin-auth/admin-roles.decorator.ts` | Declares which admin roles may access a route. |
| `src/merchants/document-requirements.ts` | Defines required and optional KYC documents for each business type. |

---

## 2. Authentication and Authorization

The admin controller uses two guards at the controller level:

```typescript
@UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
```

Every endpoint in this controller therefore requires authentication and passes through the role guard.

The current merchant application endpoints explicitly allow these roles:

- `SUPER_ADMIN`
- `COMPLIANCE`

Other roles, including `OPERATIONS` and `SUPPORT`, are not authorized to use these endpoints under the current route configuration.

The authenticated administrator's identity is obtained from `request.user`, populated by the authentication guard. The admin ID is passed to the service for audit-history recording rather than accepted from the client request body.

Admin authentication is separate from merchant authentication.

---

## 3. Endpoint Reference

Base route: `/v1/admin`

All six endpoints require an authenticated admin session and the appropriate role.

### 3.1 List merchant applications

**Endpoint**

`GET /v1/admin/merchant-applications`

**Purpose**

Retrieves a paginated list of merchant applications awaiting review or already under review.

**Allowed roles**

`SUPER_ADMIN`, `COMPLIANCE`

**Query parameters**

| Parameter | Required | Default | Description |
|---|---|---|---|
| `page` | No | `1` | Page number, starting at 1. |
| `limit` | No | `20` | Number of applications per page; maximum 100. |

**Example request**

```http
GET /v1/admin/merchant-applications?page=1&limit=20
```

**Business logic**

The service:

1. Validates pagination values.
2. Selects profiles with status `SUBMITTED` or `UNDER_REVIEW`.
3. Retrieves merchant identity details and document counts.
4. Orders results by submission time and profile ID.
5. Calculates pagination metadata.

**Response structure**

```json
{
  "data": [
    {
      "id": "profile-uuid",
      "businessName": "Example Business",
      "businessType": "SOLE_TRADER",
      "accountStatus": "SUBMITTED",
      "submittedAt": "2026-10-18T10:00:00.000Z",
      "createdAt": "2026-10-17T10:00:00.000Z",
      "merchant": {
        "id": "merchant-uuid",
        "name": "Example Merchant",
        "email": "merchant@example.com",
        "phone": "+265XXXXXXXXX"
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

The values above are illustrative.

**Possible errors**

- `400 Bad Request` — invalid pagination values.
- `401 Unauthorized` — missing or invalid admin authentication.
- `403 Forbidden` — insufficient admin role.

### 3.2 Get merchant application details

**Endpoint**

`GET /v1/admin/merchant-applications/:profileId`

**Purpose**

Retrieves the details of a specific merchant application.

**Allowed roles**

`SUPER_ADMIN`, `COMPLIANCE`

**Path parameter**

| Parameter | Description |
|---|---|
| `profileId` | UUID identifying the merchant profile. |

**Example request**

```http
GET /v1/admin/merchant-applications/profile-uuid
```

**Business logic**

The service retrieves the merchant profile together with:

- Merchant information.
- Uploaded document records.
- Review history, ordered from newest to oldest.

If the profile does not exist, the service throws `NotFoundException`.

**Possible errors**

- `401 Unauthorized` — missing or invalid admin authentication.
- `403 Forbidden` — insufficient admin role.
- `404 Not Found` — merchant application does not exist.

Merchant information is limited to ID, name, email, and phone. Document records include review status, file format and size, timestamps, rejection notes, and supersession details. Merchant credentials and document storage URLs and keys are excluded.

### 3.3 Start merchant application review

**Endpoint**

`POST /v1/admin/merchant-applications/:profileId/start-review`

**Purpose**

Moves a submitted merchant application into the review process.

**Allowed roles**

`SUPER_ADMIN`, `COMPLIANCE`

**Request body**

None.

**Example request**

```http
POST /v1/admin/merchant-applications/profile-uuid/start-review
```

**Permitted transition**

`SUBMITTED` → `UNDER_REVIEW`

**Business logic**

The service:

1. Starts a database transaction.
2. Checks whether the profile exists.
3. Confirms its current status is `SUBMITTED`.
4. Uses a conditional database update to protect against competing requests.
5. Inserts a review-history record containing the administrator's ID and the transition details.
6. Commits both changes together.

If the update or audit-history insertion fails, the transaction should roll back.

**Success response**

```json
{
  "profileId": "profile-uuid",
  "accountStatus": "UNDER_REVIEW",
  "message": "Merchant application review started."
}
```

**Possible errors**

- `401 Unauthorized` — missing or invalid admin authentication.
- `403 Forbidden` — insufficient admin role.
- `404 Not Found` — application does not exist.
- `409 Conflict` — application is not `SUBMITTED`, or another request changed its status.

### 3.4 Approve merchant application

**Endpoint**

`POST /v1/admin/merchant-applications/:profileId/approve`

**Purpose**

Approves a merchant application after validating its required KYC documents.

**Allowed roles**

`SUPER_ADMIN`, `COMPLIANCE`

**Request body**

None.

**Example request**

```http
POST /v1/admin/merchant-applications/profile-uuid/approve
```

**Permitted transition**

`UNDER_REVIEW` → `APPROVED`

**Business logic**

The service performs the approval process inside a database transaction.

1. Checks whether the profile exists.
2. Confirms the profile is currently `UNDER_REVIEW`.
3. Requires a configured business type.
4. Retrieves document requirements for that business type.
5. Checks that each required document type has at least one current, approved, unexpired document.
6. Checks that every current uploaded document is approved and unexpired.
7. Updates the profile's status, approval timestamp, and approving admin ID.
8. Clears any previous rejection reason.
9. Inserts a review-history record.
10. Commits the changes together.

Superseded documents remain in the database for historical purposes but are excluded from the current-document validation checks.

**Success response**

```json
{
  "profileId": "profile-uuid",
  "accountStatus": "APPROVED",
  "message": "Merchant application approved."
}
```

**Possible errors**

- `400 Bad Request` — business type is missing, required documents are missing or invalid, or an uploaded document requires attention.
- `401 Unauthorized` — missing or invalid admin authentication.
- `403 Forbidden` — insufficient admin role.
- `404 Not Found` — application does not exist.
- `409 Conflict` — application is not under review or its status changes concurrently.

### 3.5 Reject merchant application

**Endpoint**

`POST /v1/admin/merchant-applications/:profileId/reject`

**Purpose**

Rejects an application under review and records the reason for the decision.

**Allowed roles**

`SUPER_ADMIN`, `COMPLIANCE`

**Request body**

```json
{
  "reason": "Business registration document is invalid."
}
```

The reason must be a string and must not be empty or contain only whitespace.

**Example request**

```http
POST /v1/admin/merchant-applications/profile-uuid/reject
Content-Type: application/json
```

**Permitted transition**

`UNDER_REVIEW` → `REJECTED`

**Business logic**

The service:

1. Trims and validates the rejection reason.
2. Starts a database transaction.
3. Checks whether the application exists.
4. Confirms that the application is currently `UNDER_REVIEW`.
5. Conditionally updates the profile status from `UNDER_REVIEW` to `REJECTED`, rejecting concurrent status changes.
6. Stores the rejection reason on the merchant profile.
7. Creates a review-history entry containing the previous status, new status, reason, and admin identity.
8. Commits the changes together.

**Success response**

```json
{
  "profileId": "profile-uuid",
  "accountStatus": "REJECTED",
  "rejectionReason": "Business registration document is invalid.",
  "message": "Merchant application rejected."
}
```

**Possible errors**

- `400 Bad Request` — rejection reason is missing, null, not a string, empty, or whitespace-only.
- `401 Unauthorized` — missing or invalid admin authentication.
- `403 Forbidden` — insufficient admin role.
- `404 Not Found` — application does not exist.
- `409 Conflict` — application is not currently under review or its status changes concurrently.

The controller validates the reason's type before calling the service, which trims it and rejects empty or whitespace-only reasons.

### 3.6 Preview KYC Document

**Endpoint**

`GET /v1/admin/merchant-applications/:profileId/documents/:documentId/preview`

**Purpose**

Generates a secure, short-lived (5-minute) pre-signed download and preview URL for an uploaded merchant KYC document stored in Cloudflare R2. This allows compliance reviewers to inspect document images and PDFs directly in the browser without exposing the private storage bucket publicly.

**Allowed roles**

`SUPER_ADMIN`, `COMPLIANCE`

**Path parameters**

| Parameter | Type | Description |
|---|---|---|
| `profileId` | UUID string | ID of the merchant profile that owns the document. |
| `documentId` | UUID string | ID of the specific document record to preview. |

**Example request**

```http
GET /v1/admin/merchant-applications/550e8400-e29b-41d4-a716-446655440000/documents/e6754bfa-f6f7-4952-b8ec-f2369680376d/preview
```

**Business logic**

1. Queries `MerchantDocument` where `id === documentId` and `profileId === profileId`.
2. Throws `404 Not Found` with message `"Merchant document not found"` if the document does not exist or does not belong to the given profile.
3. Calls `R2StorageService.createDownloadUrl(document.fileKey, 300)` to generate a pre-signed S3 `GetObjectCommand` URL valid for 300 seconds.
4. Returns document metadata, the pre-signed URL, and the TTL.

**Success response — HTTP 200 OK**

```json
{
  "document": {
    "id": "e6754bfa-f6f7-4952-b8ec-f2369680376d",
    "type": "BUSINESS_REGISTRATION",
    "status": "PENDING",
    "mimeType": "application/pdf",
    "fileSizeBytes": 245120
  },
  "previewUrl": "https://<account-id>.r2.cloudflarestorage.com/solaris-kyc-documents/kyc/...",
  "expiresInSeconds": 300
}
```

**Possible errors**

- `401 Unauthorized` — missing or invalid admin session/token.
- `403 Forbidden` — insufficient admin role.
- `404 Not Found` — merchant document not found for the given profile.

---

## 4. Merchant Application Lifecycle

The current admin service implements these status transitions:

| Current status | Action | New status |
|---|---|---|
| `SUBMITTED` | Start review | `UNDER_REVIEW` |
| `UNDER_REVIEW` | Approve | `APPROVED` |
| `UNDER_REVIEW` | Reject | `REJECTED` |

Other status transitions are not implemented by these endpoints.

The service rejects invalid transitions rather than allowing administrators to move profiles arbitrarily between statuses.

### Current workflow

1. A merchant completes their onboarding information and submits an application.
2. The application becomes available in the admin application list.
3. An authorized admin opens the application details.
4. The admin starts the review.
5. The admin checks the business details and documents.
6. The admin either approves the application or rejects it with a reason.
7. The service records the status change in the review history.

The merchant-facing recovery and resubmission workflow is not covered by the five admin endpoints described here.

---

## 5. KYC Document Requirements

The approval service uses `getDocumentRequirements()` from `src/merchants/document-requirements.ts`.

The current configured policy is:

| Document type | Individual | Sole trader | Partnership | Limited company | NGO |
|---|---|---|---|---|---|
| National ID front | Required | Required | Required | Required | Required |
| National ID back | Required | Required | Required | Required | Required |
| Business registration | — | Optional | Required | Required | Required |
| Tax certificate | Optional | Optional | Optional | Required | Optional |
| Proof of address | Optional | Optional | Optional | Optional | Optional |
| Director ID | — | — | Optional | Required | Required |

This table describes the current application configuration, not a verified statement of all applicable Malawian legal or regulatory requirements. The policy should be confirmed with appropriate compliance and legal expertise before production use.

### Approval validation rules

- Each required document type needs at least one valid current document.
- A document counts as valid only when its status is `APPROVED` and it has not expired.
- Current pending, rejected, or otherwise non-approved uploads block approval.
- Current approved documents with an expired `expiresAt` date block approval.
- Superseded documents are excluded from current-document validation.
- Optional documents need not be uploaded, but any optional document that has been uploaded must satisfy the current validation rules.

---

## 6. Transaction Safety and Audit History

The service uses Prisma's `$transaction()` for status changes that must be consistent with their audit records.

Inside the transaction callback, the service uses the transaction-scoped client, `tx`, for the related database operations.

For example, approval combines:

- The profile status update.
- Approval timestamp and approving administrator.
- The review-history insertion.

Rejection combines:

- The profile status update.
- The rejection reason.
- The review-history insertion.

Starting a review combines:

- The conditional transition from `SUBMITTED` to `UNDER_REVIEW`.
- The review-history insertion.

If an operation inside the transaction fails, Prisma should roll back the transaction so that the related changes are not partially committed.

### Review history

`MerchantReviewHistory` records:

- `profileId` — the application being reviewed.
- `fromStatus` — the previous status.
- `toStatus` — the new status.
- `note` — the review note or decision reason.
- `actorType` — identifies whether the actor was a merchant, admin, or system.
- `actorId` — identifies the actor where available.
- `createdAt` — when the history entry was created.

The intended design is append-only: review-history entries should be added rather than edited or deleted during ordinary application operations.

**Testing limitation:** The service unit tests use mocked transaction clients. They verify expected calls and error propagation but do not prove that a real PostgreSQL transaction rolls back correctly. Database integration tests are needed for that guarantee.

---

## 7. Pagination and Query Behavior

The application-list endpoint accepts `page` and `limit`.

Current validation rules:

- `page` must be a positive integer.
- `limit` must be a positive integer.
- `limit` cannot exceed 100.
- The default page is 1.
- The default page size is 20.

The response includes:

- `data` — the requested applications.
- `pagination.page` — the current page.
- `pagination.limit` — the requested page size.
- `pagination.total` — the total number of matching applications.
- `pagination.totalPages` — the calculated number of pages.

The list currently includes applications in `SUBMITTED` and `UNDER_REVIEW` states. Approved and rejected applications are not included in this list.

---

## 8. Current Scope and Outstanding Work

### Implemented in the current service/controller

- [x] Paginated application listing.
- [x] Individual application lookup.
- [x] Start-review endpoint.
- [x] Approval endpoint.
- [x] Rejection endpoint with a required reason.
- [x] KYC document inspection and pre-signed preview URL generation via Cloudflare R2.
- [x] Role restrictions on application review endpoints.
- [x] Status-transition validation.
- [x] Document validation during approval.
- [x] Review-history recording.
- [x] Transaction-based status and history updates.
- [x] Unit tests for the admin service and successful project build.

### Not yet established by these endpoints alone

- [ ] Merchant-facing rejection notification emails.
- [ ] Merchant-facing rejection reason and recovery UI.
- [ ] Database integration tests proving transaction rollback against PostgreSQL.
- [ ] End-to-end tests covering the entire review workflow.
- [ ] DTO-based validation and API documentation for request bodies.
- [ ] A broader admin dashboard and admin account management API.
- [ ] Production verification of KYC document requirements and retention policy.

These items are not necessarily missing from the entire project; they are outside the six admin endpoints and service methods documented here.

---

## 9. Testing

The admin service tests are located at:

`src/admin/admin.service.spec.ts`

Run the admin service tests:

```powershell
npm test -- src/admin/admin.service.spec.ts
```

Run the admin controller tests, if the spec file exists:

```powershell
npm test -- src/admin/admin.controller.spec.ts
```

Run the project build:

```powershell
npm run build
```

Passing unit tests and a successful build provide confidence in the implementation, but do not replace integration testing against the development database.

---

## 10. Endpoint Summary

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/v1/admin/merchant-applications` | List and paginate submitted and in-review applications. |
| `GET` | `/v1/admin/merchant-applications/:profileId` | Retrieve application details, documents, and review history. |
| `POST` | `/v1/admin/merchant-applications/:profileId/start-review` | Move a submitted application into review. |
| `POST` | `/v1/admin/merchant-applications/:profileId/approve` | Validate documents and approve an application. |
| `POST` | `/v1/admin/merchant-applications/:profileId/reject` | Reject an application and record the reason. |
| `GET` | `/v1/admin/merchant-applications/:profileId/documents/:documentId/preview` | Generate secure pre-signed preview URL for an uploaded KYC document. |

All endpoints are protected by admin authentication and role guards. Application review actions are restricted to `SUPER_ADMIN` and `COMPLIANCE` under the current controller configuration.

**Summary:** The Admin module implements the merchant application review lifecycle from retrieving submitted applications, inspecting uploaded KYC documents via secure Cloudflare R2 pre-signed URLs, through approval or rejection. It combines role-based access control, KYC document validation, conditional status transitions, and transactional audit-history recording.
