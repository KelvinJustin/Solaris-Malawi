# Solaris — Unit Test Documentation

## Overview

This project uses [Vitest](https://vitest.dev/) as the test runner alongside the NestJS testing utilities (`@nestjs/testing`). All tests are unit tests — every external dependency (database, email, JWT, bcrypt) is mocked so tests run without any live services.

---

## Test Suites

### 1. `AuthService`

**File:** `src/auth/auth.service.spec.ts`

Tests the core authentication business logic. All database, email, JWT, and config dependencies are mocked.

#### `register`
| Test | What it checks |
|------|----------------|
| Creates merchant, profile, and OTP challenge | Transaction is called once; verification email is sent with a 6-digit code |
| Rejects duplicate email or phone | Throws `ConflictException`; transaction and email are never called |
| Reports email delivery failure | Throws `ServiceUnavailableException`; account is NOT rolled back |

#### `login` (first factor)
| Test | What it checks |
|------|----------------|
| Rejects unknown email | Throws `UnauthorizedException`; no OTP created |
| Rejects incorrect password | Throws `UnauthorizedException`; no OTP created |
| Rejects unverified email | Throws `UnauthorizedException`; no OTP created |
| Rejects deleted merchant | Throws `UnauthorizedException`; no OTP created |
| Rejects suspended merchant | Throws `UnauthorizedException`; no OTP created |
| Valid credentials | Invalidates previous OTPs, creates new challenge, sends 6-digit code |
| Email delivery failure | Consumes the newly created OTP; throws `ServiceUnavailableException` |

#### `verifyLogin` (second factor)
| Test | What it checks |
|------|----------------|
| Unknown merchant | Throws `UnauthorizedException` |
| Unverified merchant | Throws `UnauthorizedException` |
| Missing challenge | Throws `UnauthorizedException` |
| Expired challenge | Throws `UnauthorizedException` |
| Attempt limit reached (≥ 5) | Throws `UnauthorizedException`; no JWT issued |
| Incorrect OTP | Increments attempt count; throws `UnauthorizedException` |
| Valid OTP | Consumes challenge atomically; issues signed JWT |
| Race condition (consumed by another request) | `updateMany` returns `count: 0`; throws `UnauthorizedException`; no JWT issued |

#### `verifyEmail`
| Test | What it checks |
|------|----------------|
| Unknown merchant | Throws `UnauthorizedException` |
| Already verified | Throws `UnauthorizedException`; no challenge lookup |
| Missing challenge | Throws `UnauthorizedException` |
| Expired challenge | Throws `UnauthorizedException` |
| Attempt limit reached | Throws `UnauthorizedException` |
| Incorrect code | Increments attempt count; throws `UnauthorizedException` |
| Valid code | Consumes OTP atomically; sets `emailVerifiedAt`; no JWT issued |
| Atomic consumption fails | `merchant.update` is never called |

#### `logout`
| Test | What it checks |
|------|----------------|
| Valid session | Creates a `RevokedToken` row with correct `jti`, `merchantId`, and `expiresAt` |

#### `deleteAccount`
| Test | What it checks |
|------|----------------|
| Account not found | Throws `UnauthorizedException`; no transaction |
| Already deleted | Throws `UnauthorizedException`; no transaction |
| Active account with profile | Soft-deletes merchant; suspends profile in a transaction |
| Active account without profile | Soft-deletes merchant; skips profile update |

---

### 2. `MerchantsService`

**File:** `src/merchants/merchants.service.spec.ts`

Tests merchant profile management. Only `DatabaseService` is mocked.

#### `getMyProfile`
| Test | What it checks |
|------|----------------|
| Profile exists | Returns profile with documents included |
| Profile not found | Throws `NotFoundException` |
| Database error | Propagates the error |

#### `updateProfile`
| Test | What it checks |
|------|----------------|
| Profile exists | Calls `update` with the correct DTO; returns updated profile |
| Profile not found | Throws `NotFoundException`; `update` is never called |
| Database error | Propagates the error |

#### `submitForReview`
| Test | What it checks |
|------|----------------|
| Valid INDIVIDUAL submission | Sets status to `SUBMITTED`; clears `rejectionReason` |
| Resubmission after REJECTED | Allowed; clears previous rejection reason |
| Profile not found | Throws `NotFoundException` |
| Invalid status (e.g. already SUBMITTED) | Throws `BadRequestException` |
| Missing required documents | Throws error naming the missing document type |
| Rejected documents count as missing | Throws error naming the rejected document |
| Missing documents per business type | Parameterised across `SOLE_TRADER`, `PARTNERSHIP`, `LIMITED_COMPANY`, `NGO` |
| Database error | Propagates the error |

---

### 3. `MerchantsController`

**File:** `src/merchants/merchants.controller.spec.ts`

Tests that the controller correctly delegates to `MerchantsService` and passes the right arguments.

| Endpoint | Test |
|----------|------|
| `GET /merchants/profile` | Passes `merchantId` to `getMyProfile`; returns result |
| `GET /merchants/profile` | Propagates service errors |
| `PATCH /merchants/profile` | Passes `merchantId` and DTO to `updateProfile`; returns result |
| `PATCH /merchants/profile` | Propagates service errors |
| `POST /merchants/profile/submit` | Passes `merchantId` to `submitForReview`; returns result |
| `POST /merchants/profile/submit` | Propagates service errors |

---

### 4. `AdminAuthService`

**File:** `src/admin-auth/admin-auth.service.spec.ts`

Tests admin authentication. `bcrypt` and `node:crypto` are fully mocked.

#### `login`
| Test | What it checks |
|------|----------------|
| Valid credentials | Looks up admin, compares password, signs JWT with `sub/email/role/jti`, updates `lastLoginAt`, returns token and admin summary |
| Admin not found | Throws `UnauthorizedException`; bcrypt and JWT never called |
| Incorrect password | Throws `UnauthorizedException`; JWT never called |
| Suspended admin | Throws `UnauthorizedException` |
| Deleted admin | Throws `UnauthorizedException` |
| Database error | Propagates the error |
| JWT signing error | Propagates the error |

#### `logout`
| Test | What it checks |
|------|----------------|
| Valid session | Creates `AdminRevokedToken` row with `jti`, `adminId`, `expiresAt` |
| Database error | Propagates the error |

---

### 5. `AdminAuthController`

**File:** `src/admin-auth/admin-auth.controller.spec.ts`

Tests cookie management and request delegation for admin auth endpoints.

#### `POST /admin/auth/login`
| Test | What it checks |
|------|----------------|
| Valid credentials | Calls service; sets `admin_access_token` HTTP-only cookie; returns admin summary without `accessToken` in body |
| Authentication fails | Cookie is never set |

#### `GET /admin/auth/me`
| Test | What it checks |
|------|----------------|
| Authenticated request | Returns `id`, `email`, `role`; strips `jti` and `exp` from response |

#### `POST /admin/auth/logout`
| Test | What it checks |
|------|----------------|
| Valid session | Calls service with `adminId/jti/exp`; clears cookie; returns success message |
| Missing `adminId` | Throws `'Invalid admin session'`; service and cookie never touched |
| Missing `jti` | Throws `'Invalid admin session'`; service and cookie never touched |
| Missing `exp` | Throws `'Invalid admin session'`; service and cookie never touched |
| Service error | Cookie is never cleared |

---

### 6. `EmailService`

**File:** `src/email/email.service.spec.ts`

Tests SMTP transport configuration and email sending. `nodemailer` is mocked.

| Test | What it checks |
|------|----------------|
| Development config | Creates transport without auth (`ignoreTLS: true`) for Mailpit |
| SMTP verification | Calls `transporter.verify` on `onModuleInit` |
| `sendVerificationCode` | Sends correct subject and body containing the OTP |
| `sendLoginCode` | Sends correct subject and body containing the OTP |
| Invalid `SMTP_PORT` | Constructor throws `'SMTP_PORT must be a valid TCP port'` |

---

### 7. `DatabaseService`

**File:** `src/database/database.service.spec.ts`

Smoke test only — verifies the service initialises without errors given a valid `DATABASE_URL`. Does not connect to a real database.

---

## Running the Tests

```bash
# Run all tests
npx vitest run

# Watch mode during development
npx vitest

# Coverage report
npx vitest run --coverage
```

---

## Conventions

- **Mocking:** Every external dependency is replaced with `vi.fn()` in `beforeEach`. `vi.clearAllMocks()` runs before each test to prevent state leakage between tests.
- **Fixtures:** Shared test data (`mockAdmin`, `verifiedMerchant`, `makeChallenge`) is defined at the `describe` block level and reset or recreated in `beforeEach`.
- **Assertions:** Tests assert both the happy path return value and that the correct dependencies were called with the correct arguments. They also assert that dependencies are **not** called when they shouldn't be.
- **Error paths:** Every method has at least one test for database errors propagating unmodified to the caller.
- **Parameterised tests:** `it.each` is used for document requirement rules across business types to avoid repetition.