# Admin Authentication Module

## 1. Overview

The `admin-auth` module handles administrator authentication and session management for Solaris Malawi.

It provides three endpoints:

- Admin login
- Admin logout
- Retrieve the currently authenticated administrator

Unlike merchant authentication, **admin accounts cannot be registered through a public API**. They must be provisioned through a controlled internal process.

The module uses NestJS, JWT authentication, bcrypt password verification, HTTP-only cookies, and database-backed token revocation.

## 2. Responsibilities

The module is responsible for:

- Authenticating administrators using email and password.
- Rejecting suspended or soft-deleted administrator accounts.
- Issuing signed JWT access tokens.
- Storing access tokens in HTTP-only cookies instead of returning them in response bodies.
- Tracking the administrator's last login time.
- Revoking tokens during logout.
- Providing the authenticated administrator's identity and role.
- Protecting admin routes through `AdminJwtAuthGuard`.

Role-based authorization for restricted admin endpoints is handled separately by `AdminRolesGuard` and the `@AdminRoles()` decorator.

## 3. Endpoints

All endpoints use the `/v1` API prefix.

| Method | Endpoint | Authentication | Purpose |
|---|---|---|---|
| POST | `/v1/admin-auth/login` | Public | Authenticate an administrator |
| POST | `/v1/admin-auth/logout` | Required | Revoke the current session |
| GET | `/v1/admin-auth/me` | Required | Retrieve the current administrator |

### 3.1 Admin Login

**Endpoint**

`POST {{baseUrl}}/v1/admin-auth/login`

**Request headers**

`Content-Type: application/json`

**Request body**

```json
{
  "email": "admin@example.com",
  "password": "your-admin-password"
}
```

**Successful response — HTTP 200**

```json
{
  "message": "Admin login successful",
  "admin": {
    "id": "admin-uuid",
    "name": "System Administrator",
    "email": "admin@example.com",
    "role": "SUPER_ADMIN"
  }
}
```

The example values are placeholders. The returned administrator details come from the database.

**Authentication behaviour**

1. The service finds the administrator by email.
2. It verifies the supplied password against the stored bcrypt password hash.
3. It rejects invalid credentials with a generic error.
4. It checks that the account is active and has not been soft-deleted.
5. It generates a unique JWT identifier (`jti`).
6. It signs a JWT containing the administrator's identity, email, role, and token identifier.
7. It updates `lastLoginAt`.
8. The controller sets the JWT in the `admin_access_token` cookie.

The JWT is not included in the response body.

### 3.2 Admin Logout

**Endpoint**

`POST {{baseUrl}}/v1/admin-auth/logout`

**Authentication**

A valid `admin_access_token` cookie is required.

**Request body**

No body is required.

**Successful response — HTTP 200**

```json
{
  "message": "Admin logged out successfully"
}
```

**Logout behaviour**

1. The JWT guard authenticates the administrator.
2. The controller extracts the administrator ID, JWT identifier (`jti`), and expiry time.
3. The service creates a record in `AdminRevokedToken`.
4. The controller clears the `admin_access_token` cookie.

The revocation record prevents the same token from being reused, provided the JWT strategy checks the revocation table on protected requests.

### 3.3 Get Current Administrator

**Endpoint**

`GET {{baseUrl}}/v1/admin-auth/me`

**Authentication**

A valid `admin_access_token` cookie is required.

**Request body**

No body is required.

**Successful response — HTTP 200**

```json
{
  "id": "admin-uuid",
  "email": "admin@example.com",
  "role": "SUPER_ADMIN"
}
```

This endpoint returns the identity and role of the currently authenticated administrator. It does not return the password hash or JWT.

## 4. Authentication and Authorization

Authentication and authorization serve different purposes.

### Authentication

Authentication verifies **who the administrator is**.

`AdminJwtAuthGuard` protects routes by requiring a valid JWT. The associated JWT strategy should validate the token, verify that the administrator remains eligible to access the system, and reject revoked tokens.

### Authorization

Authorization determines **what the authenticated administrator is allowed to do**.

The `AdminRolesGuard` reads the roles specified by `@AdminRoles()` and compares them with the authenticated administrator's role.

For example:

```typescript
@UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMPLIANCE)
```

This restricts the endpoint to authenticated administrators with either the `SUPER_ADMIN` or `COMPLIANCE` role.

An administrator who is authenticated but lacks the required role receives HTTP 403 Forbidden. A missing or invalid authentication token should result in HTTP 401 Unauthorized.

Routes without role metadata are not restricted by `AdminRolesGuard` itself; authentication must still be enforced separately.

## 5. Administrator Roles

The current role enum includes:

| Role | Intended responsibility |
|---|---|
| `SUPER_ADMIN` | Broad administrative access |
| `COMPLIANCE` | Merchant application and compliance reviews |
| `OPERATIONS` | Operational workflows |
| `SUPPORT` | Customer and merchant support |

These are intended responsibilities, not automatic permissions. Actual access depends on the roles assigned to each controller endpoint.

## 6. Cookie and JWT Security

The `admin_access_token` cookie uses the following settings:

| Setting | Configuration | Purpose |
|---|---|---|
| `httpOnly` | `true` | Prevents JavaScript from reading the cookie |
| `secure` | Enabled in production | Sends the cookie over HTTPS only |
| `sameSite` | `lax` | Provides a baseline defence against cross-site request forgery |
| `path` | `/` | Makes the cookie available across API paths |
| `maxAge` | 15 minutes | Limits the browser cookie's lifetime |

The JWT's actual expiry must also be configured in the JWT signing settings. Cookie expiry and JWT expiry are separate controls.

Additional security measures include:

- Password verification with bcrypt.
- Generic errors for invalid email/password combinations.
- Rejection of inactive or soft-deleted administrator accounts.
- Unique JWT identifiers for individual sessions.
- Database-backed token revocation.
- No JWT returned in the login response body.
- No public administrator registration endpoint.

**Important:** HTTP-only cookies reduce token exposure to browser JavaScript, but they do not eliminate all cross-site request forgery risks. Production deployments should use HTTPS, an appropriate CORS policy, and CSRF protections suited to the frontend and deployment architecture.

## 7. Database Dependencies

The module uses `DatabaseService` to access the following models:

- `Admin` — stores administrator identity, password hash, role, account status, soft-deletion state, and last login time.
- `AdminRevokedToken` — records revoked JWT identifiers, associated administrator IDs, and token expiry times.

The module also uses `JwtService` to sign access tokens.

The stored password must be a bcrypt hash generated during the controlled administrator provisioning process. Plain-text passwords must never be stored.

## 8. Configuration

The module relies on the application's existing JWT configuration and the following environment setting:

```env
NODE_ENV=development
```

In production:

```env
NODE_ENV=production
```

Set the JWT signing secret and token-expiry configuration through the application's existing configuration system. Use a strong secret, keep it out of source control, and do not reuse development secrets in production.

The cookie's 15-minute `maxAge` is currently hardcoded in the controller.

## 9. Testing with Bruno

Set the Bruno environment variable:

```text
baseUrl = http://localhost:3000
```

Adjust the host and port to match your running API.

### Test 1 — Login

- Method: `POST`
- URL: `{{baseUrl}}/v1/admin-auth/login`
- Body: JSON containing the provisioned administrator's email and password.

Verify that the response contains the administrator's identity and role, and that the response headers set the `admin_access_token` cookie.

### Test 2 — Current Administrator

- Method: `GET`
- URL: `{{baseUrl}}/v1/admin-auth/me`
- Body: None.

Verify that the authenticated administrator's ID, email, and role are returned.

Run this request after login, using the cookie received from the login response.

### Test 3 — Logout

- Method: `POST`
- URL: `{{baseUrl}}/v1/admin-auth/logout`
- Body: None.

Verify that the logout confirmation is returned and the cookie is cleared.

### Test 4 — Reuse the Revoked Token

Attempt to call `/v1/admin-auth/me` with the previously issued token after logout.

The request should fail with HTTP 401 if the JWT strategy checks the revocation table and the revoked token is still being presented.

### Test 5 — Invalid Credentials

Submit an incorrect email/password combination.

Verify that authentication fails and that the response does not reveal whether a particular email address exists.

### Test 6 — Inactive Administrator

Attempt to log in with a suspended or soft-deleted administrator account.

Verify that login is rejected.

### Test 7 — Unauthenticated Access

Call `/v1/admin-auth/me` without an authentication cookie.

Verify that the request returns HTTP 401 Unauthorized.

### Test 8 — Role-Based Access

Authenticate using an administrator whose role does not meet the requirements of a protected admin endpoint.

Verify that the endpoint returns HTTP 403 Forbidden.

## 10. Current Scope and Limitations

The module currently supports administrator login, logout, and retrieval of the current administrator.

It does not provide:

- Public administrator registration.
- Administrator creation or provisioning endpoints.
- Password reset or password change workflows.
- Multi-factor authentication.
- Administrative session management UI.
- Automatic cleanup of expired revoked-token records.

Administrator provisioning must remain a controlled internal operation. Password recovery, multi-factor authentication, and more detailed audit controls can be implemented as separate features.

## 11. Future Improvements

Recommended improvements before production include:

1. Add integration tests for login, logout, cookie behaviour, and revoked-token rejection using a real test database.
2. Verify that JWT expiry and cookie expiry remain aligned.
3. Add rate limiting to login attempts.
4. Implement a secure administrator password reset process.
5. Consider multi-factor authentication for privileged accounts.
6. Add audit logging for sensitive administrative actions.
7. Define and test a scheduled cleanup policy for expired revoked-token records.
8. Review CSRF protection, CORS configuration, and cookie settings against the final deployment architecture.
9. Ensure that every protected admin endpoint explicitly defines its authorization requirements where appropriate.

## 12. Summary

The `admin-auth` module provides the authentication foundation for Solaris Malawi's administrative API. It verifies administrator credentials, manages JWT sessions through an HTTP-only cookie, supports token revocation, and exposes the current administrator's identity.

Authorization is handled separately through role-based guards. Keeping authentication, authorization, and administrator provisioning separate makes the administrative security model easier to maintain and extend.
