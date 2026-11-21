# NOWPayments Adapter and FX Quotes

This document describes the NOWPayments integration currently implemented in the backend. It is an implementation guide and status report, not a declaration of production readiness.

## Components

- `src/payment-providers/adapters/nowpayments/nowpayments-api.client.ts` calls the NOWPayments v1 API. Mutating payment creation is not automatically retried because an ambiguous retry could create duplicate provider-side state.
- `nowpayments-payment-provider.adapter.ts` converts the MWK transaction amount into the configured price currency, creates the provider payment, persists its crypto-specific details and quote snapshot, and returns payment instructions.
- `provider-callbacks.controller.ts` exposes `POST /v1/provider-callbacks/nowpayments` and verifies `x-nowpayments-sig` before accepting a notification.
- `provider-callbacks.service.ts` records the reported provider event and applies guarded attempt/transaction updates. A successful `finished` notification posts through `CryptoLedgerPostingService` in the same Prisma transaction as those status changes.
- `nowpayments-status.util.ts` maps provider statuses to internal payment states.
- `src/fx/fx-rate.provider.ts` provides MWK conversion quotes. `FX_RATE_PROVIDER` is an abstraction token so the adapter does not depend on a concrete quote source.
- `src/config/nowpayments.config.ts` and `src/config/fx.config.ts` use the existing root Nest `ConfigModule` configuration pattern.

The adapter is registered with the existing provider registry alongside `TEST`. NOWPayments-specific information is persisted in `crypto_payment_details`; received IPNs are retained in `crypto_payment_ipn_events`. The migration also creates the NOWPAYMENTS MWK provider-clearing account used by ledger capture.

## Checkout contract

The customer starts crypto payment through the existing public checkout route:

```http
POST /v1/checkout/:token/pay
Content-Type: application/json

{
  "provider": "NOWPAYMENTS",
  "payCurrency": "usdttrc20"
}
```

`payCurrency` is required for NOWPayments; `network` is optional. Do not treat the example currency as a complete list of supported currencies—the provider's current availability must be confirmed against its documentation.

The crypto ledger's `parseNowPaymentsCurrency` mapping is deliberately not exhaustive. Unknown tickers currently fall back to their uppercase ticker with no network split, which can create a balance account inconsistent with a dashboard's asset/network model. Before enabling additional currencies, compare NOWPayments `GET /v1/full-currencies` with the parser mapping and add explicit asset/network mappings for the supported set.

When invoice creation succeeds, the response includes `payment_instructions` with `paymentAddress`, `payAmount`, `payCurrency`, `network`, and `expiresAt`. An accepted initiation means that payment instructions were created; it does not mean the customer has paid. The original transaction and its ledger amounts remain denominated in MWK.

## IPN lifecycle

The public callback URL embedded in the provider request is `/v1/provider-callbacks/nowpayments`. Production configuration requires a public HTTPS base URL reachable by NOWPayments. The endpoint rejects missing or invalid signatures and unrecognized payload statuses.

Current status handling:

| NOWPayments status | Internal behavior |
|---|---|
| `waiting`, `confirming`, `confirmed`, `sending` | Remain in processing. |
| `partially_paid` | Move to pending reconciliation; do not credit as a successful payment. |
| `finished` | Mark the payment successful and post the ledger capture atomically with the state transition. |
| `failed`, `expired` | Mark the payment failed. |
| `refunded` | A refund before a final success moves to pending reconciliation. A refund IPN after success is recorded, but the finalized transaction remains successful for manual handling; no automatic reversal is posted. |

Duplicate/finalized attempt updates are guarded. Unknown provider payment IDs are logged and ignored. Reconciliation, manual refund handling, and ledger reversal operations are not automated by this adapter.

## Configuration

The namespaced config is loaded by the application's root `ConfigModule`. Configure these values in the backend environment; do not put credentials in source control.

| Environment variable | Required / default | Purpose |
|---|---|---|
| `NOWPAYMENTS_API_KEY` | Required in production | Authenticates outbound API requests. |
| `NOWPAYMENTS_IPN_SECRET` | Required in production | Verifies incoming IPNs. |
| `PUBLIC_API_BASE_URL` | Required in production; HTTPS | Public origin used to construct the versioned IPN callback URL. |
| `NOWPAYMENTS_BASE_URL` | `https://api.nowpayments.io/v1` | API base URL; override for a supported test environment if appropriate. |
| `NOWPAYMENTS_PRICE_CURRENCY` | `usd` | Fiat price currency used for provider invoice creation. |
| `NOWPAYMENTS_MAX_FX_QUOTE_AGE_SECONDS` | `300` | Maximum age of the locally fetched quote when starting payment. |
| `NOWPAYMENTS_FEE_BPS` | `0` | Merchant-absorbed crypto fee in basis points (100 bps = 1%). Must be an integer from 0 to 9999; configure only an approved rate. |
| `FX_RATE_API_BASE_URL` | `https://open.er-api.com/v6/latest` | FX endpoint base; the provider requests the MWK base-rate document. |
| `FX_RATE_POLL_INTERVAL_MS` | `15000` | In-process polling interval. |

Missing API credentials are not silently replaced with credentials or a fake provider response. In production, the configuration module fails during application startup if the API key, IPN secret, or public HTTPS callback base URL is missing.

## Status reconciliation

A process-local reconciliation service checks stale in-flight payments once per minute. It queries records not updated for five minutes, processes at most 50 per run, and calls NOWPayments `GET /payment/:payment_id`. Returned statuses go through the same guarded state transition and crypto-ledger posting path as signed IPNs. The job starts only when `NOWPAYMENTS_API_KEY` is configured, and resumes polling after an application restart. Duplicate polling across application instances is safe for posting because status transitions and crypto posting identity are database-guarded, but the scheduler itself is not a distributed queue or lock.

Provider lookup failures are logged and retried after the payment becomes stale again. This reduces the risk of a lost IPN leaving a payment in `PROCESSING` indefinitely while the application is running. It does not replace operational monitoring, live-provider validation, or manual handling of partial payments and refunds.

## FX freshness limitation

The default FX source publishes rates daily, although the application polls every 15 seconds. The quote's `capturedAt` timestamp means the time the local process fetched the document. The max-age check therefore verifies cache age, **not** how recently the upstream rate was published. It does not establish that the underlying rate is current.

The cache is process-local, so different application instances can have different values and a restart begins with a cold cache. Before production use, choose a source and freshness policy that meet the business requirements, validate upstream publication timestamps, and decide how quote consistency should work across instances.

## Persistence and failure boundary

The provider invoice is created before `CryptoPaymentDetail` is persisted. If the provider creates the payment but local persistence fails, a provider-side invoice may be left without a corresponding local detail record. This should be addressed with a documented recovery/reconciliation strategy before production traffic is enabled. Provider request/response behavior has not been exercised against a live sandbox in this project.

The Prisma migration is `20261120224343_add_crypto_payment_details`. Apply migrations using the repository's normal Prisma migration workflow. PostgreSQL integration tests must target a dedicated local test database, never a development or production database.

## Verification and readiness

The implementation was verified with:

- FX and NOWPayments unit tests (6 files, 16 tests).
- PostgreSQL payment-capture, settlement, and NOWPayments integration tests.
- Backend build and Prisma schema validation; the dedicated test database reported all migrations applied.

These are local automated checks. They do not prove live API compatibility, sandbox payment completion, IPN network reachability, upstream FX freshness, production configuration, or operational recovery from a provider/local persistence mismatch. Until those checks are completed, describe the integration as implemented and locally tested, not production-ready.

## Related documentation

- [API Reference](./apiReference.md)
- [Architecture Overview](./overview.md)
- [Ledger Module](./ledgerModule.md)
- [Unit Testing](../development/unitTesting.md)
