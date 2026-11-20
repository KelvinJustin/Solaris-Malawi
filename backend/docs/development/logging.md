# Logging and Request Correlation

This guide documents the logging implementation currently used by Solaris. NestJS/Pino logs are written to both rotating files and stdout; file output is a first-class destination, not a replacement for container output.

## 1. Runtime setup

`src/app.module.ts` configures `nestjs-pino` asynchronously and `src/main.ts` installs it as the Nest application logger:

```ts
const app = await NestFactory.create(AppModule, {
  bufferLogs: true,
});
app.useLogger(app.get(Logger));
```

This routes Nest logger calls and HTTP request logs through Pino. Use the existing Nest `Logger` where that is the established service pattern. Use `createFileLogger(context)` for standalone scripts that do not run inside Nest, and call `flushFileLogger(logger)` before process exit.

## 2. Destinations, rotation, and configuration

The Pino targets are configured in `src/logging/pino-targets.ts`:

- A rotating file target with prefix `solaris` and `.log` extension.
- Daily rotation and a 20 MiB size limit.
- Up to 14 rotated files retained by the target.
- A stdout target for container/runtime log collection.
- Parent directories are created automatically.

Configure these environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `LOG_LEVEL` | `info` | Minimum Pino severity (`trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`). |
| `LOG_DIR` | `logs` | Log directory. Relative paths resolve from the process working directory. |

The file target is resolved under `LOG_DIR` using the `solaris` prefix. For a local backend process started from `backend/`, the default directory is `backend/logs`. Docker Compose mounts `./logs` to `/app/logs`, so files survive container recreation while stdout remains available to Docker.

Ensure the service account can write to the configured directory. In production, prefer a persistent volume with restricted access and ship copies to a managed log platform; local rotating files alone are not durable disaster recovery.

## 3. HTTP request logs

HTTP request logging is configured in `AppModule`:

- Each request gets an ID from a valid incoming `x-request-id` header or a generated UUID.
- Accepted IDs match `^[A-Za-z0-9._:-]{1,128}$`; malformed or oversized values are replaced.
- Request fields are limited to request ID, method, route template, and remote address. Query strings and request bodies are not serialized by the request serializer.
- Response serialization includes the status code.
- Successful responses log at `info`, 4xx responses at `warn`, and 5xx responses or errors at `error`.
- The route serializer uses the route template; unmatched routes are labelled rather than logging a raw URL.

The configured redaction list censors authorization, cookie, API-key, provider-signature, and request-ID headers, and `Set-Cookie` response headers. Do not add raw request/response bodies or secrets to serializers.

Request IDs are also attached to Prisma query tags in `main.ts` for correlation between an HTTP request and database query metadata. A request ID is a correlation value, not an authorization credential.

## 4. Application and script logging

Nest services may use the Nest `Logger`, which is backed by Pino once `app.useLogger()` is installed. For scripts such as the fee-policy seeder and ledger backfill, use the file logger helper:

```ts
const logger = createFileLogger('my-script');
try {
  logger.info({ operation: 'example' }, 'Starting operation');
} finally {
  await flushFileLogger(logger);
}
```

Pino supports structured fields; prefer stable identifiers, event names, and status values over interpolated free-form messages. Do not log passwords, OTPs, access tokens, provider secrets, payment credentials, KYC document contents, or unnecessary customer personal information.

Financial postings and policy changes are not defined by the application log files. Posted ledger rows are the financial record, and `FeePolicyAuditEvent` is the policy lifecycle audit record. Logs can help diagnose operations but must not be used to reconstruct balances or replace accounting records.

## 5. Operations and troubleshooting

- If stdout logs appear but files do not, check `LOG_DIR`, the process working directory, directory permissions, and that the file transport can create the directory.
- If logs are too verbose, set `LOG_LEVEL` to `info` or `warn`; use `debug` only for controlled diagnosis.
- Monitor free disk space and confirm rotation/retention behavior in the deployment environment.
- Restrict access to log files: they may contain operational identifiers even after sensitive headers are redacted.
- When forwarding logs, preserve the structured JSON and request ID, and apply retention/access controls in the destination.
- The existing log redaction is field-based. Any new logging of DTOs, provider payloads, error objects, or headers must be reviewed for secrets and personal data before being added.

The API does not currently promise a separate durable security-event stream or a complete financial audit trail through Pino. Add those as explicitly designed systems if operational requirements call for them.
