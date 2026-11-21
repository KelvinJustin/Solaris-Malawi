# NOWPayments Adapter

The NOWPayments adapter is registered in `PaymentProvidersModule` beside the `TEST` adapter. It creates provider payments only for transactions already denominated in a supported crypto asset and network.

The adapter obtains a USD estimate from NOWPayments because the provider API requires a fiat `price_amount`. It then submits that reference together with the transaction's exact crypto amount as `pay_amount`. The USD estimate is provider metadata only: it is not an MWK conversion, does not alter the transaction amount, and is not used to credit merchant balances.

The integration's endpoint contracts, provider signature validation, payment lifecycle, fee configuration, reconciliation cadence, and limitations are documented in [NOWPayments Crypto Integration](./nowpaymentsIntegration.md).
