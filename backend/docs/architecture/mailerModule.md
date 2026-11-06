
The transporter is created once in the constructor and reused across all
`sendEmail` calls — Nodemailer manages the connection pool internally.

---

## 5. API

### 5.1 `sendEmail(to, subject, text)`

Generic send method. All specific email methods delegate here.

```typescript
await this.emailService.sendEmail(
  'merchant@example.com',
  'Subject line',
  'Plain text body.',
);
```

| Parameter | Type | Description |
|---|---|---|
| `to` | `string` | Recipient address |
| `subject` | `string` | Email subject line |
| `text` | `string` | Plain-text body |

Returns the Nodemailer `SentMessageInfo` object. Throws on SMTP failure —
callers are responsible for catching and handling the error.

> **HTML support:** `sendEmail` currently sends plain text only. To add HTML,
> extend the signature with an optional `html` parameter and pass it to
> `sendMail`. Plain text should always accompany HTML as a fallback.

---

### 5.2 `sendVerificationCode(to, code)`

Sends the 6-digit OTP issued during merchant registration.

```typescript
await this.emailService.sendVerificationCode('merchant@example.com', '048291');
```

**Subject:** `Verify your Solaris email`

**Behaviour in `AuthService`:**
- Called after the merchant record and `OtpChallenge` are created.
- The raw `code` is passed here; the hashed version is what is stored in the
  database — this service never sees or stores the hash.
- If this throws, the registration still completes (the merchant exists in the
  DB). The merchant will need to request a new code. Will wrap in a
  try/catch and returning a warning if delivery cannot be confirmed later today.

---

### 5.3 `sendLoginCode(to, code)`

Sends the 6-digit OTP for the second factor of the login flow.

```typescript
await this.emailService.sendLoginCode('merchant@example.com', '739102');
```

**Subject:** `Your Solaris login verification code`

**Behaviour in `AuthService`:**
- The `OtpChallenge` row is written to the database **before** this is called.
- If this throws, `AuthService.login()` immediately marks the challenge as
  consumed (`consumedAt: new Date()`) so the undelivered code can never be
  verified. A `503 Service Unavailable` is returned to the caller.

---

## 6. Error Handling

`sendEmail` re-throws whatever Nodemailer raises. Each call site handles
failures differently:

| Call site | On failure |
|---|---|
| `sendVerificationCode` (registration) | Currently unhandled — registration succeeds but the merchant won't receive the code. Wrap in try/catch and surface a warning. |
| `sendLoginCode` (login) | Caught in `AuthService.login()` — the challenge is consumed and `503` is returned. This is the safe pattern. |

Future email calls (approval notifications, settlement alerts) should follow
the login pattern: decide upfront whether a send failure is fatal or
degradable, and handle it explicitly.

---

## 7. Extending EmailService

Add a new method for each new email type. Do not add logic to `sendEmail`
itself — keep it generic.

```typescript
// Example: merchant approval notification
async sendApprovalNotification(to: string, businessName: string) {
  return this.sendEmail(
    to,
    'Your Solaris account has been approved',
    `Hi ${businessName},

Your Solaris merchant account has been reviewed and approved.
You can now accept payments.

Log in to your dashboard: https://dashboard.Solaris.mw`,
  );
}
```

Planned emails to add as the merchant module is built:

| Trigger | Method to add |
|---|---|
| Admin approves merchant | `sendApprovalNotification` |
| Admin rejects merchant | `sendRejectionNotification` |
| Admin suspends merchant | `sendSuspensionNotification` |
| Settlement paid out | `sendSettlementReceipt` |
| Payment received | `sendPaymentNotification` |
| Password reset (future) | `sendPasswordResetCode` |

---

## 8. Testing

For local development you can use [Mailpit](https://github.com/axllent/mailpit) or
[Mailtrap](https://mailtrap.io) — both provide an SMTP server that captures
outgoing mail without delivering it.

```env
# Mailpit defaults (runs on localhost)
SMTP_SERVER=localhost
SMTP_PORT=1025
SMTP_USER=
SMTP_API_KEY=
SMTP_FROM=Solaris <noreply@Solaris.mw>
```

Mailpit's web UI is available at `http://localhost:8025` by default.

You may use brevo to mimick production

To verify the transporter can reach the SMTP server on startup, add a
`verifyTransporter()` call in an `onModuleInit` hook:

```typescript
async onModuleInit() {
  await this.transporter.verify();
}
```

Will remove this in production or guard it behind a non-production check — a
failed verify on startup will crash the application.

---

## 9. Current Limitations

| # | Limitation |
|---|---|
| 1 | Plain text only — no HTML templates. will probably do that later otp test dont need a beefy email design for now |
| 2 | No retry logic — a transient SMTP failure is a permanent failure for that send. will address today|
| 3 | `sendVerificationCode` failure during registration is silently swallowed — the merchant is stuck without a code. Will address today|
| 4 | No email queue — high send volume will block the event loop. sSolved using BullMQ + a worker for anything beyond low traffic. |
| 5 | No delivery tracking — there is no record of whether an email was actually delivered. |