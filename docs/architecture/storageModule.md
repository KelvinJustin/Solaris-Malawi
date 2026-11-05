# Storage & Document Upload Module

## 1. Overview

The Storage and Document Upload architecture provides secure, direct-to-cloud object storage for Know Your Customer (KYC) identity and business verification documents in Solaris Malawi.

It integrates **Cloudflare R2** (via the AWS S3-compatible API) with NestJS and Prisma/PostgreSQL to handle document uploads, binary content verification, audit tracking, and administrative inspection.

### Key Objectives

- **Direct-to-Cloud Uploads:** File binaries are uploaded directly from the merchant's browser or mobile client to Cloudflare R2 using short-lived pre-signed `PUT` URLs. This prevents large file streams from consuming Solaris API server memory, CPU, and bandwidth.
- **Strict Verification & Zero Trust:** Uploaded objects are never trusted based on client claims alone. When an upload is finalized, the server inspects object headers and reads binary magic-byte signatures directly from storage before registering the document.
- **Compromise Remediation:** If an uploaded file fails size, MIME type, or binary signature checks, it is immediately deleted from R2 and rejected.
- **Auditability & Supersession:** When a merchant replaces an existing document type (e.g., uploading an updated Tax Certificate), previous versions are not overwritten; they are atomically marked as superseded (`supersededAt`, `supersededByDocumentId`) to preserve a strict compliance audit trail.
- **Zero Public Access:** The R2 bucket is strictly private. Object keys are stored internally (`r2://...`), and files can only be accessed via time-limited pre-signed URLs (300-second TTL) requested by authorized compliance administrators.

### Main Files & Services

| File | Responsibility |
|---|---|
| `src/storage/storage.module.ts` | Exports `R2StorageService` for consumption across the application. |
| `src/storage/r2-storage.service.ts` | Wraps `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` to handle URL signing, metadata fetching, binary signature reads, and object deletion. |
| `src/merchants/merchant-documents.service.ts` | Manages upload intent creation, validation of completed uploads, document persistence, supersession, and merchant document listing. |
| `src/merchants/dto/request-document-upload.dto.ts` | Validates initial upload requests (`type`, `contentType`). |
| `src/merchants/merchants.controller.ts` | Exposes merchant document endpoints (`/upload-url`, `/:uploadId/complete`, `/documents`). |
| `src/admin/admin.service.ts` | Generates pre-signed download/preview URLs for compliance officers. |
| `src/admin/admin.controller.ts` | Exposes admin document preview endpoint (`/merchant-applications/:profileId/documents/:documentId/preview`). |

---

## 2. High-Level Architecture & Workflow

The direct-to-cloud upload workflow follows a 4-phase sequence:

```text
Merchant Client                  Solaris API                     Cloudflare R2            PostgreSQL
      │                               │                                │                      │
      │ 1. POST /documents/upload-url │                                │                      │
      │──────────────────────────────>│                                │                      │
      │                               │ ── Create Upload Intent Record ──────────────────────>│ (MerchantDocumentUpload)
      │                               │ ── Generate Pre-signed PUT URL │                      │
      │                               │    (5-minute expiry)           │                      │
      │<──────────────────────────────│                                │                      │
      │   uploadId, uploadUrl         │                                │                      │
      │                               │                                │                      │
      │ 2. Direct HTTP PUT Binary Data                                │                      │
      │───────────────────────────────────────────────────────────────>│                      │
      │   (Headers: Content-Type)                                      │                      │
      │                                                                │                      │
      │ 3. POST /documents/:uploadId/complete                          │                      │
      │──────────────────────────────>│                                │                      │
      │                               │ ── Fetch Object Metadata       │                      │
      │                               │───────────────────────────────>│                      │
      │                               │<───────────────────────────────│                      │
      │                               │    ContentLength, ContentType  │                      │
      │                               │                                │                      │
      │                               │ ── Read Magic-Byte Signature   │                      │
      │                               │    (Range: bytes=0-15)         │                      │
      │                               │───────────────────────────────>│                      │
      │                               │<───────────────────────────────│                      │
      │                               │                                │                      │
      │                               │ [Validation passed?]           │                      │
      │                               │   YES: Atomically insert       │                      │
      │                               │        MerchantDocument, mark  │                      │
      │                               │        prior as superseded,    │                      │
      │                               │        close upload intent ──────────────────────────>│ (Prisma $transaction)
      │                               │   NO:  Delete object from R2   │                      │
      │                               │        and throw 400 ─────────>│                      │
      │<──────────────────────────────│                                │                      │
      │   201 Created Document Record │                                │                      │
```

---

## 3. Storage Service Implementation (`R2StorageService`)

`R2StorageService` encapsulates all interactions with Cloudflare R2 using the AWS SDK v3 S3 client.

### Client Configuration

```typescript
this.client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.getOrThrow<string>('R2_ACCESS_KEY_ID'),
    secretAccessKey: config.getOrThrow<string>('R2_SECRET_ACCESS_KEY'),
  },
});
```

### Methods Reference

#### `createUploadUrl(key: string, contentType: string): Promise<string>`
Generates a pre-signed `PutObjectCommand` URL expiring in **300 seconds (5 minutes)**. The pre-signed URL enforces the expected `ContentType` header during the HTTP `PUT` request.

#### `createDownloadUrl(objectKey: string, expiresInSeconds = 300): Promise<string>`
Generates a pre-signed `GetObjectCommand` URL for downloading or viewing an object. Used by the Admin module for compliance document previews.

#### `createPreviewUrl(key: string): Promise<string>`
Generates a pre-signed `GetObjectCommand` URL with `ResponseContentDisposition: 'inline'` for in-browser rendering.

#### `getObjectMetadata(key: string)`
Sends a `HeadObjectCommand` to retrieve object headers from R2, including `ContentLength` and `ContentType`.

#### `readFileSignature(key: string): Promise<Uint8Array>`
Reads only the initial 16 bytes of the object using HTTP range request (`Range: 'bytes=0-15'`). This minimizes bandwidth while allowing binary magic-number inspection.

#### `deleteObject(key: string): Promise<void>`
Issues a `DeleteObjectCommand` to remove invalid, corrupted, or rejected files from R2 storage.

#### `onModuleDestroy(): void`
Implements NestJS lifecycle hook to cleanly destroy the underlying `S3Client` connection pool when the application shuts down.

---

## 4. Document Verification & Security Safeguards

### 4.1 Allowed Document Types & Constraints

| Parameter | Allowed Values / Range | Enforcement Location |
|---|---|---|
| **MIME Types** | `application/pdf`, `image/jpeg`, `image/png` | DTO validation & server-side verification |
| **Max File Size** | 10 MiB (`10 * 1024 * 1024` bytes = 10,485,760 bytes) | `MerchantDocumentsService.completeUpload` |
| **Min File Size** | > 0 bytes (must be non-empty) | `MerchantDocumentsService.completeUpload` |
| **Upload Window** | 5 minutes from creation | `MerchantDocumentUpload.expiresAt` |
| **Allowed Profile Statuses** | `PENDING_SUBMISSION`, `REJECTED` | `MerchantDocumentsService.requestUpload` |

### 4.2 Magic-Byte Binary Signature Verification

File extensions and HTTP `Content-Type` headers can easily be spoofed by malicious clients. To protect against malicious executables or polyglot files disguised as PDFs or images, `MerchantDocumentsService` checks the true byte signature:

| Declared MIME Type | Expected Magic Bytes (Hex) | Description |
|---|---|---|
| `application/pdf` | `25 50 44 46 2d` | ASCII `%PDF-` header |
| `image/png` | `89 50 4e 47 0d 0a 1a 0a` | Standard 8-byte PNG header |
| `image/jpeg` | `ff d8 ff` | Standard JPEG Start-Of-Image marker |

If `hasValidSignature()` returns `false`:
1. The uploaded file is immediately deleted from Cloudflare R2 using `r2StorageService.deleteObject(intent.objectKey)`.
2. A `400 Bad Request` with message `"The file contents do not match the declared format"` is thrown.
3. No `MerchantDocument` database record is created.

---

## 5. Document Lifecycle & Supersession

Each merchant application requires specific document types based on business entity (e.g., `NATIONAL_ID_FRONT`, `NATIONAL_ID_BACK`, `BUSINESS_REGISTRATION`, `TAX_CERTIFICATE`).

### Superseding Older Versions

When a merchant uploads a new document of a type they previously provided:
1. The new document is verified and inserted with status `PENDING`.
2. Within the same atomic Prisma transaction (`$transaction`), all earlier documents for that profile and document type where `supersededAt` is null are updated:
   - `supersededAt = new Date()`
   - `supersededByDocumentId = newDocument.id`
3. The previous file remains in Cloudflare R2 and PostgreSQL for historical and regulatory audit purposes.
4. When listing documents (`GET /v1/merchants/documents`), the API dynamically exposes:
   ```json
   "isCurrent": true // false if supersededAt is set
   ```
5. When validating an application for submission or approval, only documents where `supersededAt === null` are considered.

---

## 6. Admin Document Preview Integration

Compliance officers and Super Administrators need to inspect uploaded KYC documents before approving an application.

### Preview Flow

1. Admin requests preview: `GET /v1/admin/merchant-applications/:profileId/documents/:documentId/preview`
2. Authorization: Guard checks that the caller is authenticated as an admin with role `SUPER_ADMIN` or `COMPLIANCE`.
3. Existence Check: Database confirms the document belongs to the specified `profileId`.
4. URL Generation: `AdminService` calls `R2StorageService.createDownloadUrl(document.fileKey, 300)`.
5. The API returns:
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
6. The admin's browser accesses the secure pre-signed link directly. Once 300 seconds elapse, the URL automatically expires.

---

## 7. Database Schema Details

### Model: `MerchantDocumentUpload` (`merchant_document_uploads`)

Tracks pre-signed upload intents and prevents replay attacks.

```prisma
model MerchantDocumentUpload {
  id               String       @id @default(uuid()) @db.Uuid
  profileId        String       @db.Uuid
  type             DocumentType
  objectKey        String       @unique
  expectedMimeType String
  expiresAt        DateTime
  completedAt      DateTime?
  createdAt        DateTime     @default(now())

  profile MerchantProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId, expiresAt])
  @@map("merchant_document_uploads")
}
```

### Model: `MerchantDocument` (`merchant_documents`)

Stores finalized document records.

```prisma
model MerchantDocument {
  id                     String         @id @default(uuid()) @db.Uuid
  profileId              String         @db.Uuid
  type                   DocumentType
  status                 DocumentStatus @default(PENDING)
  fileUrl                String
  fileKey                String
  mimeType               String
  fileSizeBytes          Int
  uploadedAt             DateTime       @default(now())
  updatedAt              DateTime       @updatedAt
  rejectionNote          String?
  reviewedAt             DateTime?
  supersededAt           DateTime?
  supersededByDocumentId String?        @db.Uuid

  profile MerchantProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId, type, status])
  @@map("merchant_documents")
}
```

---

## 8. Configuration & Environment Variables

Add the following environment variables to `.env` (refer to `.env.example`):

```env
# Cloudflare R2 Storage Configuration
R2_ACCOUNT_ID="your-cloudflare-account-id"
R2_ACCESS_KEY_ID="your-r2-access-key"
R2_SECRET_ACCESS_KEY="your-r2-secret-key"
R2_BUCKET_NAME="solaris-kyc-documents"
```

---

## 9. Testing & Bruno Verification Recipes

### 1. Request Upload URL (Merchant)
- **Method:** `POST`
- **URL:** `{{baseUrl}}/v1/merchants/documents/upload-url`
- **Headers:** `Content-Type: application/json`
- **Body:**
  ```json
  {
    "type": "BUSINESS_REGISTRATION",
    "contentType": "application/pdf"
  }
  ```
- **Expected Response:** `201 Created` with `uploadId`, `uploadUrl`, and `expiresAt`.

### 2. Upload File Directly to Cloudflare R2
- **Method:** `PUT`
- **URL:** `{{uploadUrl}}` (obtained from Step 1)
- **Headers:** `Content-Type: application/pdf`
- **Body:** Binary file content (PDF file <= 10 MiB)
- **Expected Response:** `200 OK`

### 3. Finalize Upload (Merchant)
- **Method:** `POST`
- **URL:** `{{baseUrl}}/v1/merchants/documents/{{uploadId}}/complete`
- **Body:** None
- **Expected Response:** `201 Created` with `MerchantDocument` details (`status: "PENDING"`).

### 4. Admin Preview Document
- **Method:** `GET`
- **URL:** `{{baseUrl}}/v1/admin/merchant-applications/{{profileId}}/documents/{{documentId}}/preview`
- **Authentication:** Admin bearer token / session cookie (`SUPER_ADMIN` or `COMPLIANCE` role)
- **Expected Response:** `200 OK` containing temporary `previewUrl` (expires in 300s).
