# Database Setup & Prisma Guide

This guide documents the database setup used by the current Solaris Malawi codebase. It reflects the repository as it exists today rather than a generic template.

## 1. Overview

Solaris uses PostgreSQL with Prisma ORM 7 and the Prisma Postgres driver adapter package `@prisma/adapter-pg`.

The project configuration is defined in `prisma/schema.prisma` and `prisma7.config.ts`:

```ts
// prisma7.config.ts
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
```

Important project-specific details:

- Prisma client generation output is set to `src/generated/prisma`
- The app uses `DatabaseService extends PrismaClient` with a `PrismaPg` adapter
- The database is configured through `DATABASE_URL` in the environment

## 2. Environment requirement

Set a PostgreSQL connection string in `.env` before starting the application:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/Solaris?schema=public"
```

The repo includes the example values in `.env.example`. Do not commit real credentials.

## 3. Prisma schema and generated client

The schema defines the current business models for merchant onboarding, document review, admin accounts, payment lifecycle state, crypto payments, and provider settlement reconciliation.

The generator is configured as:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

After changing the schema, regenerate the client:

```bash
npx prisma generate --config prisma7.config.ts
```

## 4. Database service implementation

The project uses a custom database service in `src/database/database.service.ts`.

It:

- reads `DATABASE_URL` from the environment
- creates a `PrismaPg` adapter
- connects during `onModuleInit()`
- verifies the PostgreSQL server and database identity before serving requests
- disconnects cleanly during shutdown

This is the authoritative database integration in the application.

## 5. Migration workflow

Apply existing migrations with:

```bash
npx prisma migrate deploy --config prisma7.config.ts
```

Create a new migration during development:

```bash
npx prisma migrate dev --config prisma7.config.ts --name <migration_name>
```

For quick schema experiments without migration files, `prisma db push` is available, but the project primarily uses migrations in `prisma/migrations/`. Do not use `db push` as a substitute for migrations that include custom PostgreSQL indexes, constraints, or triggers; the ledger migration includes partial unique indexes and database triggers that are represented only in SQL.

## 6. Current schema focus

The existing schema includes models for:

- `Merchant`
- `MerchantProfile`
- `MerchantDocument`
- `MerchantReviewHistory`
- `Admin`
- `OtpChallenge`
- `RevokedToken`
- `AdminRevokedToken`
- `PaymentTransaction`, with shared payment identity and lifecycle state
- `MwkPaymentDetail` and `CryptoPaymentDetail`, which keep payment terms in their native denomination
- `LegacyMwkPaymentSnapshot`, which preserves the former MWK invoice/fee snapshot for historical transactions that already had crypto payment details
- `PaymentAttempt`
- `CheckoutSession`
- `MerchantLedger` (legacy balances retained for reconciliation)
- `FeePolicy` and `FeePolicyAuditEvent`
- `LedgerAccount`, `LedgerTransaction`, `LedgerEntry`, and `LedgerAccountBalance`
- NOWPayments IPN event history
- Provider settlement batches/items, normalized imports, bank statement lines, allocations, approvals, and audit events

The financial/payment part of the schema is active. MWK fee terms are snapshotted at creation; crypto fees are calculated from the provider-reported amount using `NOWPAYMENTS_FEE_BPS`. Successful verified provider events post to their denomination-specific ledger in the same database transaction as payment and attempt updates. Settlement reconciliation separately supports normalized imports and controlled approval/posting against bank-credit evidence. Provider- and bank-specific parsers and merchant fund release are not implemented. See the [ledger module guide](../architecture/ledgerModule.md) for accounting behavior and historical cutover precautions.

New crypto transactions use `PaymentType.CRYPTO`, a `CryptoPaymentDetail` containing the merchant-selected asset, network, and exact decimal amount, and the `NOWPAYMENTS` provider. MWK transactions continue to use integer tambala in `MwkPaymentDetail`. Each transaction must have exactly one matching detail, and payment terms become immutable after processing starts. The split-financial-details migration backfills existing payment records and archives the former MWK snapshot for historical crypto transactions; it does not make the old MWK amount the denomination of newly created crypto transactions.

Apply migrations, including `20261121140000_split_payment_financial_details`, to the intended database with `npx prisma migrate deploy --config prisma7.config.ts` before deploying code that expects this schema. This migration contains custom PostgreSQL constraints/triggers and should not be replaced with `prisma db push`. Review the SQL and back up the target database according to the deployment process; do not test it against a shared development or production database.

## 7. Database validation and maintenance

Useful commands:

```bash
npx prisma generate --config prisma7.config.ts
npx prisma migrate status --config prisma7.config.ts
npx prisma studio --config prisma7.config.ts
```

The app expects a working PostgreSQL database before it can initialize. The `DatabaseService` fails startup if the connection is missing or invalid.

## 8. Local development note

The Docker Compose setup in this repository does not include a PostgreSQL container. The app depends on a reachable database via `DATABASE_URL`. Compose starts Redis, but the current backend source does not use it.

This is intentional and should be reflected in local setup instructions.