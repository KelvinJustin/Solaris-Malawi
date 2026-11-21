// nowpayments-provider.adapter.ts
import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PaymentProvider } from '../../../generated/prisma/enums.js';
import type {
  CryptoInitiationInput,
  CryptoInitiationResult,
  PaymentProviderAdapter,
} from '../../contracts/payment-provider.interface.js';
import { NowPaymentsApiClient } from './nowpayments-api.client.js';
import { FX_RATE_PROVIDER } from '../../../fx/fx-rate.provider.js';
import type { FxRateProvider } from '../../../fx/fx-rate.provider.js';
import { DatabaseService } from '../../../database/database.service.js';

@Injectable()
export class NowPaymentsProviderAdapter implements PaymentProviderAdapter {
  constructor(
    private readonly client: NowPaymentsApiClient,
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    @Inject(FX_RATE_PROVIDER) private readonly fxRateProvider: FxRateProvider,
    readonly provider: PaymentProvider,
  ) {}

  async initiatePayment(
    input: CryptoInitiationInput,
  ): Promise<CryptoInitiationResult> {
    const priceCurrency = this.configService.get<string>(
      'nowpayments.settlementPriceCurrency',
    )!;
    const maxFxQuoteAgeSeconds = this.configService.get<number>(
      'nowpayments.maxFxQuoteAgeSeconds',
    )!;
    const publicApiBaseUrl = this.configService.get<string>(
      'nowpayments.publicApiBaseUrl',
    );

    if (!publicApiBaseUrl) {
      return {
        outcome: 'REJECTED',
        failureCode: 'CONFIG_MISSING',
        failureMessage: 'PUBLIC_API_BASE_URL is not configured; cannot build an IPN callback URL.',
      };
    }

    // 1. Get a fresh FX quote and reject rather than guess if it's stale.
    const quote = await this.fxRateProvider.getRate(priceCurrency);
    const ageSeconds = (Date.now() - quote.capturedAt.getTime()) / 1000;
    if (ageSeconds > maxFxQuoteAgeSeconds) {
      return {
        outcome: 'REJECTED',
        failureCode: 'FX_QUOTE_STALE',
        failureMessage: `FX quote for MWK->${priceCurrency} is ${Math.round(ageSeconds)}s old, exceeding the ${maxFxQuoteAgeSeconds}s limit.`,
      };
    }

    const amountMwk = input.amountTambala / 100;
    const rate = Number(quote.rate);
    const priceAmount = Math.round(amountMwk * rate * 100) / 100; // 2dp for a fiat quote

    if (!Number.isFinite(priceAmount) || priceAmount <= 0) {
      return {
        outcome: 'REJECTED',
        failureCode: 'FX_CONVERSION_FAILED',
        failureMessage: 'Converted price amount was invalid.',
      };
    }

    // 2. Create the invoice with NOWPayments.
    const versionedApiBaseUrl = publicApiBaseUrl.endsWith('/v1')
      ? publicApiBaseUrl
      : `${publicApiBaseUrl}/v1`;
    let created;
    try {
      created = await this.client.createPayment({
        priceAmount,
        priceCurrency,
        payCurrency: input.payCurrency,
        orderId: input.attemptReference, // PaymentAttempt rows are never reused — safe as a NOWPayments idempotency key
        orderDescription: `Solaris payment ${input.transactionReference}`,
        ipnCallbackUrl: `${versionedApiBaseUrl}/webhooks/nowpayments`,
      });
    } catch {
      return {
        outcome: 'UNKNOWN',
        failureCode: 'PROVIDER_REQUEST_FAILED',
        failureMessage: 'NOWPayments did not return a usable response for payment creation.',
      };
    }

    // 3. Persist the crypto-specific detail row. This happens in the adapter
    // (not the caller) because the caller only knows the generic
    // ProviderInitiationResult shape — the FX rate and raw invoice fields
    // are NOWPayments-specific and belong with the code that produced them.
    await this.databaseService.cryptoPaymentDetail.create({
      data: {
        attemptId: input.attemptReference,
        nowpaymentsPaymentId: created.payment_id,
        payCurrency: created.pay_currency,
        payAmount: created.pay_amount,
        priceCurrency: created.price_currency,
        priceAmount: created.price_amount,
        fxRateMwkToPriceCurrency: quote.rate,
        fxRateCapturedAt: quote.capturedAt,
        paymentAddress: created.pay_address,
        network: created.network ?? null,
        lastReportedStatus: created.payment_status,
        invoiceExpiresAt: created.expiration_estimate_date
          ? new Date(created.expiration_estimate_date)
          : null,
      },
    });

    return {
      outcome: 'ACCEPTED',
      providerReference: created.payment_id,
      paymentAddress: created.pay_address,
      payAmount: String(created.pay_amount),
      payCurrency: created.pay_currency,
      network: created.network ?? input.network,
      expiresAt: created.expiration_estimate_date
        ? new Date(created.expiration_estimate_date)
        : null,
    };
  }
}