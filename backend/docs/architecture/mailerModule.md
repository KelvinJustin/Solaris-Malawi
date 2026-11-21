# Email Module

## Overview

`EmailModule` provides a shared Nodemailer SMTP service used by merchant registration and login verification. It sends plain-text messages and is not backed by a queue or delivery-tracking store.

The module is registered in `src/app.module.ts` and provides `EmailService` to the merchant-auth feature.

## Configuration

The transporter reads these settings through Nest `ConfigService`:

| Environment variable | Purpose |
|---|---|
| `SMTP_SERVER` | SMTP hostname; required. |
| `SMTP_PORT` | SMTP TCP port; required and validated as an integer from 1 to 65535. |
| `SMTP_FROM` | Sender address; required when sending. |
| `SMTP_USER` | Optional SMTP username. |
| `SMTP_API_KEY` | Optional SMTP password/API key, used with `SMTP_USER`. |
| `NODE_ENV` | In non-production mode, TLS negotiation is ignored to support local SMTP capture services. |

Port 465 enables Nodemailer's `secure` transport option. SMTP authentication is enabled only when both `SMTP_USER` and `SMTP_API_KEY` are configured. Never commit real SMTP credentials.

At module initialization, the service verifies the SMTP transporter. A failure is logged and does not currently prevent the application from starting. Email send operations themselves propagate errors to their callers.

## Supported messages

`EmailService` currently sends:

- Registration email verification codes, valid for 10 minutes.
- Login second-factor codes, valid for 10 minutes.

Messages are plain text. The service reuses a single transporter and exposes a generic `sendEmail(to, subject, text)` method plus the two OTP-specific methods.

## Failure behavior

Email send failures are handled differently by each auth flow:

- **Registration:** the merchant, initial profile, and verification challenge are committed before email is sent. If send fails, the request returns `503 Service Unavailable`; the account remains created and the user may request a new verification email.
- **Login:** the login challenge is created before email send. If delivery fails, the challenge is marked consumed and the request returns `503`.
- **Resend verification:** a delivery failure is surfaced by the auth service; the API does not claim delivery succeeded.

There is no automatic retry, background queue, or delivery-status tracking. A `503` during registration does not mean the database transaction rolled back.

## Local development and tests

Mailpit or another local SMTP capture service can be configured, for example:

```env
SMTP_SERVER=127.0.0.1
SMTP_PORT=1025
SMTP_FROM="Solaris Malawi <no-reply@solaris.local>"
SMTP_USER=
SMTP_API_KEY=
```

The unit tests in `src/email/email.service.spec.ts` mock Nodemailer; they verify transport configuration, startup verification behavior, OTP message content, and invalid-port handling. They do not prove delivery through a real SMTP provider.

## Current scope

Not implemented:

- HTML templates.
- Retry/backoff or an email queue.
- Delivery/bounce tracking.
- Approval, settlement, payment receipt, password-reset, or other notification types.
