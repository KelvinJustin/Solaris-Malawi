# Ledger Module and V1 Cutover Guide

This document describes the ledger behavior implemented in Solaris today: successful payment capture, normalized provider-to-bank settlement posting, and historical payment backfill. It is not a general accounting or merchant balance API.

## 1. Scope and invariants

The MWK ledger records a provider-confirmed successful MWK payment as a balanced, immutable double-entry transaction. Crypto payments use a separate native-asset ledger described in [Crypto payment postings](#10-crypto-payment-postings). The ledgers are financial records for their own denominations; `MerchantLedger` remains a legacy table for reconciliation and is not used as the ledger source of truth.

The implementation enforces these rules:

- Every posted transaction has at least two positive entries.
- Total debits equal total credits, and every entry uses the transaction currency.
- MWK payment amounts are integer tambala (`100 tambala = 1 MWK`). Persisted MWK entry amounts use PostgreSQL `BIGINT` / Prisma `BigInt`; crypto entries use exact decimal amounts in the original asset/network.
- A posted transaction and its entries cannot be changed or deleted. Corrections require a future compensating posting flow; direct edits are not supported.
- One payment-success posting is permitted per payment, enforced by the unique tuple `sourceType`, `sourceId`, and `postingPurpose`.
- Projection updates and ledger entries are committed atomically.

The MWK ledger handles MWK provider-clearing accounts, which are receivables from payment providers, not evidence that cash has reached a Solaris bank account.
Merchant pending and merchant available are separate liability concepts; only merchant-pending accounts exist. Settlement posting clears provider receivables against reconciled bank credits but does not release merchant funds to an available balance or expose a merchant balance API.

## 2. V1 boundaries

Implemented now:

- Successful provider callback posting.
- Platform default and merchant-specific versioned fee policies.
- Immutable fee snapshots stored on each MWK payment.
- Provider-clearing, merchant-pending, and fee-revenue accounts.
- Account debit/credit balance projections.
- Controlled, dry-run-first historical successful-payment backfill.
- Provider-neutral settlement reconciliation and bank-receipt posting after approval.

Not implemented in this phase:

- Provider- or bank-specific statement parsers and external report format handling.
- Merchant funds release from pending to available.
- Withdrawals, refunds, chargebacks, reversals, or manual adjustments.
- Merchant/admin ledger or balance API endpoints.
- An asynchronous posting worker or outbox for ledger posting.

A `SUCCEEDED` payment means provider confirmation was accepted. It does not mean provider cash has settled or that the merchant can withdraw the funds.

## 3. Models and account mapping

The Prisma schema contains these primary ledger models:

| Model                  | Purpose                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `LedgerAccount`        | Identifies an asset, liability, or revenue account and its currency/owner.          |
| `LedgerTransaction`    | Groups entries for one business event and stores source and provenance.             |
| `LedgerEntry`          | Records a positive debit or credit to one account.                                  |
| `LedgerAccountBalance` | Atomic debit/credit totals used as a read projection; entries remain authoritative. |
| `FeePolicy`            | Immutable fee definition, version, scope, active state, and source.                 |
| `FeePolicyAuditEvent`  | Append-only creation/activation/deactivation history.                               |

V1 account keys are deterministic:

- `provider-clearing:<currency>:<provider>` — asset, debit-normal. The MWK mappings for Airtel Money, TN Mpamba, TEST, and NOWPAYMENTS are created by migrations and must be active before posting.
- `merchant-pending:<currency>:<merchantId>` — liability, credit-normal. Created when the merchant first receives a ledger posting.
- `platform-fee-revenue:<currency>` — revenue, credit-normal. Created only when a nonzero fee is posted.

Account ownership and currency are checked before use. The migration also constrains the allowed account ownership shape.

## 4. Payment accounting

At successful callback time, the posting is:

| Account                     | Direction |                 Amount |
| --------------------------- | --------- | ---------------------: |
| Provider clearing           | Debit     |          Gross payment |
| Merchant pending settlement | Credit    |           Merchant net |
| Platform fee revenue        | Credit    | Fee, only when nonzero |

For example, for a MWK 1,000.00 payment with a MWK 20.00 merchant-absorbed fee:

- Gross: `100,000` tambala
- Fee: `2,000` tambala
- Merchant net: `98,000` tambala

The debit of `100,000` equals the two credits (`98,000 + 2,000`). With the initial ZERO policy, the full amount is credited to merchant pending settlement and no zero-value revenue entry is created.

The provider-clearing debit represents an amount receivable from the provider. Bank-receipt settlement posting clears this receivable against bank evidence. Release to an available balance and payment to a merchant remain separate accounting events that are not implemented.

`LedgerAccountBalance` stores debit and credit totals independently. For a debit-normal account its displayed balance is `debitTotal - creditTotal`; for a credit-normal account it is `creditTotal - debitTotal`. The totals are updated in the posting transaction and must equal the corresponding sums of entries in `POSTED` ledger transactions. Ledger entries remain the accounting source of truth.

## 5. Callback transaction boundary and idempotency

`ProviderCallbacksService` verifies the callback signature and payload before opening its Prisma transaction. Inside that transaction it:

1. Loads the attempt and its payment and validates provider, reference, amount, and currency.
2. Uses conditional `updateMany` state transitions to claim the attempt and finalize the payment.
3. Calls `LedgerPostingService.postSuccessfulPayment` only after a valid transition to `SUCCEEDED`.
4. Creates the ledger transaction and entries and updates the balance projections using the same `Prisma.TransactionClient`.
5. Commits everything together, or rolls all payment, attempt, ledger, and projection changes back together on error.

Failed or unsupported outcomes do not post successful-payment entries. A repeated callback with the same terminal outcome returns as a duplicate. Conditional state updates serialize competing callbacks; the database uniqueness constraint is the final guard against duplicate payment postings. No external HTTP request, notification, or webhook delivery is performed inside this database transaction.

The ledger posting service does not open its own transaction. Callers are responsible for supplying the transaction client that owns the surrounding business operation.

## 6. Fee calculation and snapshots

Fee types are `ZERO`, `PERCENTAGE`, `FIXED`, and `HYBRID`. V1 fees are merchant-absorbed; customer surcharges are not implemented. Percentage values use integer basis points (`100 bps = 1%`). Percentage rounding is half-up to the nearest tambala:

```text
percentageFee = (amountTambala * percentageBps + 5000) / 10000
```

Fixed and hybrid amounts are in tambala. A fee must be nonnegative and less than the payment amount, leaving a positive merchant net.

At payment creation the service resolves an active merchant policy first and falls back to the active platform policy for the currency. The payment stores the fee amount, merchant net, fee type, rate, fixed component, currency, policy ID, and policy version. Database triggers prevent changing the snapshot later. Callback posting reads those stored amounts; it never recalculates an old payment using the current policy.

The migration creates the initial active platform-wide ZERO/MWK policy at version 1. No fee-management endpoint is exposed. Create new versions only with the controlled seeder from `backend/`:

```bash
npm run seed:fees -- --type PERCENTAGE --percentage-bps 200 --version 2 --source "approved pricing change" --activate
npm run seed:fees -- --type FIXED --fixed-tambala 50000 --version 1 --merchant-id <merchant-uuid> --source "approved merchant agreement" --activate
npm run seed:fees -- --type HYBRID --percentage-bps 150 --fixed-tambala 1000 --version 1 --source "approved pricing change" --activate
```

Supported options include `--currency` (defaults to `MWK`), `--merchant-id` (omit for a platform policy), and `--activate`. Version numbers must be the next version in that merchant/currency scope. When activating, the tool deactivates the current policy, writes audit events, and activates the new version in one transaction. The database has partial unique indexes to prevent multiple active merchant policies or multiple active platform defaults for the same currency.

Do not activate a commercial rate until the pricing arrangement is approved. The tool is configuration/seeding only; it does not provide merchant or Super Admin API functionality.

## 7. Historical backfill and reconciliation

The backfill command scans historical payment records and produces a report by default. From `backend/`:

```bash
npm run ledger:backfill
npm run ledger:backfill -- --report=./reports/ledger-cutover.json
```

The report is created exclusively so an earlier report cannot be overwritten. By default it is written under `LOG_DIR` (or `backend/logs`). It includes eligible and already-posted payments, excluded/ambiguous records and reasons, nonzero legacy `MerchantLedger` values, and existing/projected pending balances.

A payment is eligible only when it is `SUCCEEDED`, has a merchant and provider, has provider reference and processed time, has a matching `SUCCEEDED` attempt with provider reference and completion time, has a positive amount, and has an active provider-clearing account mapping. Non-success payment states (such as `CREATED`, `PROCESSING`, `FAILED`, and `PENDING_RECONCILIATION`), as well as successful but ambiguous records, are reported as excluded. Each eligible payment is uniquely posted as source `PAYMENT` / purpose `SUCCESS`, so a rerun does not duplicate a posting.

For legacy MWK payment records, the migration adds a zero-fee snapshot because this codebase had no reliable historical fee fields. It does not change original payment status, amount, or timestamps. Backfilled ledger transactions record `HISTORICAL_BACKFILL` provenance and a backfill timestamp. Each payment is applied in a separate database transaction; failed items are reported and can be retried safely.
An existing non-`POSTED` transaction is reported and excluded; the command does not repair it automatically, so investigate and resolve it manually before retrying. Nonzero legacy `MerchantLedger` balances are reported separately and are never inferred as opening balances.

To post, first review the dry-run report and obtain cutover/reconciliation approval, then explicitly use:

```bash
npm run ledger:backfill -- --apply
```

Do not treat the resulting pending balances as available or withdrawable. The backfill does not convert, overwrite, or discard legacy `MerchantLedger` values; it reports nonzero records because their accounting meaning is not established by the old model. Pending and available amounts must not be conflated.

Never run the apply mode against production without a reviewed report, a database backup/change plan, and financial reconciliation approval.

## 8. Migration and testing

The schema and migrations are in `prisma/schema.prisma` and `prisma/migrations/`. Across the migration set, the database adds fee/ledger and settlement tables, bank statement imports, allocation controls, crypto payment details/IPN history, and indexes; seeds the ZERO/MWK policy and provider-clearing mappings (including NOWPAYMENTS); initializes legacy fee snapshots to zero; and installs constraints/triggers for immutable snapshots, posted entries, balanced postings, allocation limits, and active-policy uniqueness.

Unit tests use Vitest mocks and are not evidence of PostgreSQL locking or trigger behavior. PostgreSQL integration tests include payment-capture, provider-settlement, and NOWPayments webhook cases under `src/ledger/`, `src/settlements/`, and `src/payment-providers/adapters/nowpayments/`. They require a dedicated test database; use `LEDGER_TEST_DATABASE_URL` where required by the ledger specs and configure Prisma's `DATABASE_URL` to the same test database. Never fall back to a development or production database.

Create a dedicated local test database first (for example, execute `CREATE DATABASE solaris_ledger_test;` using a local PostgreSQL administrator client). Never use the configured development or production database. Set the test URL and the Prisma CLI's `DATABASE_URL` to that same test database in PowerShell, from `backend/`:

```powershell
$env:LEDGER_TEST_DATABASE_URL = "postgresql://<user>:<password>@localhost:5432/solaris_ledger_test?schema=public"
$env:DATABASE_URL = $env:LEDGER_TEST_DATABASE_URL
npx prisma migrate deploy --config prisma7.config.ts
npx prisma migrate status --config prisma7.config.ts
npx prisma validate --config prisma7.config.ts
npm run test:ledger:integration
npm test -- src/ledger src/provider-callbacks/provider-callbacks.service.spec.ts
npm run build
```

The integration suite exercises database-backed idempotency, concurrent posting, transactional rollback, persisted fee snapshots, settlement allocation constraints, and NOWPayments webhook behavior. It does not validate provider/bank parsers against real reports or establish production readiness. Never point test or migration commands at development or production databases.

## 9. Provider settlement infrastructure (Phase 2)

The Phase 2 implementation is provider-neutral and supports normalized settlement imports, matching, bank allocation, approval, and settlement capture. It does not implement provider settlement parsers or bank reconciliation against real external formats, nor merchant fund release, withdrawals, or refunds.

Normalized provider imports preserve:

- Provider and provider-account identity.
- Source filename, SHA-256 checksum, object key, and format identifier.
- Batch reference, currency, period, gross amount, provider fee, and expected net.
- Immutable source-row identity and raw normalized JSON records.

Normalized bank statement imports preserve the bank account, checksum, object key, format identifier, period, row identity, transaction/value dates, and credit/debit amounts. Parser-specific behavior remains a future integration point. No Airtel, TNM, or bank report columns or reference formats are inferred.

Payment matching uses the normalized `providerPaymentReference` as an exact match against `PaymentTransaction.providerReference` for the same provider. Results distinguish matched, unmatched, ambiguous, amount mismatch, currency mismatch, duplicate, unsupported, invalid, and not applicable. Amount-only matching is not used.

Bank allocations are append-only, idempotency-keyed, and protected inside `SERIALIZABLE` PostgreSQL transactions. A batch may receive multiple bank credits and a bank credit may support multiple batches. An allocation cannot exceed either the batch net remaining or the line credit remaining. Concurrent attempts are resolved by row locks and the database; a second allocation beyond remaining amount is rejected.

Bank allocation limits are enforced both in the service transaction and by a PostgreSQL trigger. Direct database writes cannot allocate beyond the batch net or the imported bank-credit amount, and allocation cannot be added after a batch is approved or posted.

Approved provider settlement posting uses the reconciled bank receipts:

| Account | Direction | Amount |
| --- | --- | --- |
| Platform bank cash | Debit | Each allocated bank credit |
| Provider processing expense | Debit | Provider fee, if nonzero |
| Provider clearing | Credit | Gross provider settlement |

The merchant-pending liability is unchanged by settlement. The posting is uniquely identified by `sourceType = PROVIDER_SETTLEMENT`, `sourceId = batch id`, and `postingPurpose = BANK_RECEIPT`. It is created only after SUPER_ADMIN approval and remains one posting under concurrent post attempts. Before posting, the service verifies that the batch gross does not exceed the posted provider-clearing debit balance less prior settlement credits.

OPERATIONS may import normalized data and reconcile/allocate. SUPER_ADMIN may approve and post. Existing `AdminJwtAuthGuard` and `AdminRolesGuard` enforce these routes. The settlement service rechecks the actor's active role and status for direct calls. Separation of duties is enforced: the approver cannot be an actor who reconciled or allocated the batch, and the poster cannot be the approver or a reconciliation actor.

The settlement tables, imports, batch/items, bank lines, allocations, and audit events are append-only or immutable after relevant approval/posting states. Direct mutation of posted batch evidence and provider postings is prohibited.

REST integration points use normalized JSON at:

```text
POST /admin/settlements/provider-imports/normalized
POST /admin/settlements/bank-statements/normalized
POST /admin/settlements/:batchId/reconcile
POST /admin/settlements/allocations
POST /admin/settlements/:batchId/approve
POST /admin/settlements/:batchId/post
```

These normalized endpoints do not decode source-provider or bank-specific report formats. Actual parsers must remain separate integration adapters until sanitized samples and specifications are available.

## 10. Crypto payment postings

NOWPayments capture uses a separate native-asset ledger (`CryptoLedgerAccount`, `CryptoLedgerTransaction`, `CryptoLedgerEntry`, and `CryptoLedgerAccountBalance`) rather than converting `actually_paid` back to MWK. Crypto requests persist the merchant's exact asset, network, and decimal-string amount before provider initiation. `CryptoLedgerPostingService` debits provider crypto clearing and credits the merchant's crypto liability; a nonzero fee adds a platform crypto revenue credit. The payment state, crypto detail, and posting are updated in the same Prisma transaction.

`NOWPAYMENTS_FEE_BPS` controls the merchant-absorbed crypto fee against the provider-reported `actually_paid` amount. It is an integer basis-point setting from 0 to 9999; the default is `0` to preserve current behavior until a rate is approved. The crypto fee is separate from the MWK fee-policy snapshot, and this ledger does not expose a merchant balance or withdrawal API.
