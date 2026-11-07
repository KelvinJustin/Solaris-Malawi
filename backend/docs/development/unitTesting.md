# Solaris Backend Testing Guide

## Purpose

This document describes how the backend test suite is structured, what is being validated, and which edge cases are intentionally covered. It is meant to be the operational reference for backend developers working in this repository, not a placeholder README.

The backend uses Vitest with NestJS testing utilities. The suite is designed to validate application behavior under mocked dependencies rather than to exercise a live database, SMTP server, or Redis instance.

---

## 1. Test runner and execution

From the backend directory:

```bash
npm test -- --run
```

To run a single spec file:

```bash
npx vitest run src/auth/auth.service.spec.ts
```

To run a subset of matching specs:

```bash
npx vitest run src/transactions src/provider-callbacks
```

The project is currently configured to run all backend unit tests in a single suite through the package script defined in `package.json`.

---

## 2. Testing philosophy

The backend tests follow a strict unit-test model:

- external infrastructure is mocked
- service logic is validated with real business rules
- controller tests verify delegation and response shape
- security-sensitive paths are tested against invalid input, replayed data, and malformed payloads
- failures are treated as contract errors when the application should reject them

This is not a “just defined” suite. The tests are written to prove behavior under edge conditions such as:

- duplicate emails or phone numbers during registration
- wrong or expired OTP challenges
- idempotency-key collisions with conflicting payloads
- callback signature mismatches and stale timestamps
- expired checkout sessions
- unapproved merchant profiles attempting payment creation
- file metadata and upload signing failures for storage flows

---

## 3. Current suite inventory

The backend test suite currently covers the following files and responsibilities:

### Authentication and authorization

#### `src/auth/auth.service.spec.ts`
Covers merchant authentication and account lifecycle flows:

- registration with duplicate email/phone rejection
- OTP challenge creation for first-factor login
- invalid, expired, or exhausted login challenge handling
- second-factor verification with attempt counting
- email verification flow and atomic consumption of OTP codes
- logout revocation flow
- soft-delete account handling
- transaction-aware behavior for registration and account deletion

#### `src/auth/auth.controller.spec.ts`
Covers request/response behavior for auth endpoints:

- login request forwarding
- cookie-based session handling
- verification request shapes
- error propagation from service to HTTP layer

#### `src/admin-auth/admin-auth.service.spec.ts`
Covers admin authentication domain:

- valid admin login with JWT creation
- rejection of missing, suspended, or deleted admins
- incorrect password handling
- JWT signing errors
- logout token revocation behavior

#### `src/admin-auth/admin-auth.controller.spec.ts`
Covers admin cookie/session contract and controller delegation:

- login sets `admin_access_token`
- `me` endpoint strips sensitive JWT details
- logout clears cookies and validates required session values

### Merchant operations

#### `src/merchants/merchants.service.spec.ts`
Covers merchant profile management:

- fetching the merchant profile
- updating profile data
- submitting profile for review
- validation of missing documents
- resubmission after rejection
- business-type-specific document requirements

#### `src/merchants/merchants.controller.spec.ts`
Covers controller delegation and request payload plumbing for merchant endpoints.

#### `src/merchants/document-requirements.spec.ts`
Validates the document requirement logic used to determine whether a merchant profile is complete enough to submit or proceed.

### Payment and checkout

#### `src/transactions/transactions.service.spec.ts`
This is one of the most important backend specs because it validates the real payment lifecycle rules:

- idempotency-key requirement
- rejecting transactions for merchants whose profile is not approved
- creating both transaction and checkout session records
- reusing identical payment data when the same idempotency key is reused
- rejecting conflicting idempotency payloads
- validating checkout session state and `canPay` conditions
- expired, active, and consumed session handling
- checkout metadata shaping and URL generation

#### `src/transactions/transactions.controller.spec.ts`
Validates controller-level delegation, response serialization, and request parameter handling for transaction endpoints.

### Provider callbacks and payment state transitions

#### `src/provider-callbacks/provider-callbacks.service.spec.ts`
This is the security-critical callback suite. It covers:

- valid signed callback acceptance
- duplicate callback detection for unchanged final state
- rejection of unsupported callback events
- stale or invalid timestamps
- malformed amount values that cannot be represented in tambala
- mismatch between stored transaction/provider metadata and callback data
- provider state transitions and payment transaction finalization logic

#### `src/provider-callbacks/provider-callbacks.controller.spec.ts`
Covers controller validation and delegation for callback endpoints.

### Storage and file operations

#### `src/storage/r2-storage.service.spec.ts`
Validates the Cloudflare R2 / S3-backed upload and storage logic:

- initialization with default config values
- custom endpoint configuration and path-style behavior
- signed upload and download URL generation
- preview URL generation with inline disposition
- object metadata lookup using `headObject`
- invalid body handling for file-signature detection
- object deletion behavior
- module initialization bucket verification

### Email and infrastructure

#### `src/email/email.service.spec.ts`
Validates the email transport configuration and outbound messages:

- development SMTP setup
- verification step on module init
- verification-code emails
- login-code emails
- invalid SMTP port handling
- failure propagation and error handling

#### `src/database/database.service.spec.ts`
Validates database abstraction behavior and any service-level assumptions around the Prisma-backed database layer.

### App-level health and smoke tests

#### `src/app.controller.spec.ts`
Covers the root application-level controller and basic health/smoke behavior.

---

## 4. High-value edge cases explicitly enforced by tests

The backend suite is intentionally strong on the cases that most often cause real production bugs:

### Authentication and security

- expired or absent OTP challenge
- OTP brute-force attempts and attempt-limit enforcement
- duplicate registration attempts
- deleted or suspended merchants/admins being blocked from login
- invalid JWT or callback signatures

### Payment correctness

- idempotency-key reuse with different payloads is rejected
- merchant approval gating is enforced before payment creation
- checkout sessions enforce validity windows
- callback payloads must match stored provider, amount, and transaction metadata

### Storage correctness

- invalid file bodies are rejected before download or upload completion
- metadata lookups and cleanup behavior are asserted at the service boundary
- custom endpoint configuration is verified for local S3-compatible setups

---

## 5. Mocking conventions and test patterns

The suite uses consistent patterns across services:

- `Test.createTestingModule()` for isolated NestJS providers
- `DatabaseService` replaced with mock objects whose methods return controlled values
- `vi.fn()` used for all dependency-level call assertions
- `beforeEach` resets mocks so each test is independent
- service contracts are asserted via observable behavior rather than implementation leakage

Examples of good patterns used in this suite:

- checking whether a method was called with the correct args
- asserting thrown exceptions for invalid state transitions
- verifying a mutation occurs only when the business rule allows it
- checking the exact behavior of signed payloads and callback validation

This keeps the tests precise without depending on internal implementation details that can change without altering public behavior.

---

## 6. What the current suite is not

This is not a full end-to-end application test suite. It intentionally does not cover:

- real PostgreSQL migrations or database integration
- live SMTP delivery in a real environment
- real external payment provider networking
- Redis-backed session orchestration in production-like conditions
- UI flows

The goal is to provide strong contract-level validation of the backend’s business logic and edge cases while keeping tests deterministic and fast.

---

## 7. Recommended workflow for writing or improving tests

When adding or revising tests, prefer the following order:

1. test the public contract (input, output, thrown exception)
2. cover the acceptance path and the rejection path
3. test the edge case that breaks business invariants
4. verify defensive behavior for malformed or replayed data
5. assert only observable behavior, not private implementation details

In short: every new test should answer one question:

“What should the backend do when this state or payload occurs?”

---

## 8. Practical examples of the suite’s intent

A few examples of the strongest test cases currently present:

- `AuthService` ensures the login challenge is invalidated after a successful verification attempt.
- `ProviderCallbacksService` verifies that the HMAC is calculated against the raw request body, not the parsed JSON object.
- `TransactionsService` rejects a reused idempotency key when the payment data differs, preventing accidental double-submission.
- `R2StorageService` validates the SDK configuration used for local S3-compatible storage and Cloudflare R2.

These are the kinds of tests that guard against real regressions in a payment and onboarding system.

---

## 9. Summary

The backend test suite is comprehensive in the right way for this architecture:

- it emphasizes business rules over trivial “should be defined” tests
- it covers failure paths and edge cases that matter in production
- it tests security-sensitive flows and state transitions explicitly
- it protects the API contract without depending on live infrastructure

The suite is reliable for validating service-level behavior in this modular NestJS backend, and it is intentionally designed to catch the kinds of regressions that matter most in payment, auth, and file-handling workflows.
