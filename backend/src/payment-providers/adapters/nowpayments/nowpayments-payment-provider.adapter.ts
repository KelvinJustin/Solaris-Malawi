import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../../generated/prisma/client.js';
import { PaymentProvider } from '../../../generated/prisma/enums.js';
import { DatabaseService } from '../../../database/database.service.js';
import { formatCryptoAmount } from '../../../ledger/crypto-asset.util.js';
import type {
  CryptoInitiationInput,
  CryptoInitiationResult,
  PaymentProviderAdapter,
} from '../../contracts/payment-provider.interface.js';
import {
  NowPaymentsApiClient,
  type NowPaymentsPaymentResponse,
} from './nowpayments-api.client.js';

@Injectable()
export class NowPaymentsProviderAdapter implements PaymentProviderAdapter {
  private readonly logger = new Logger(NowPaymentsProviderAdapter.name);

  constructor(
    private readonly client: NowPaymentsApiClient,
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    readonly provider: PaymentProvider,
  ) {}

  async initiatePayment(
    input: CryptoInitiationInput,
  ): Promise<CryptoInitiationResult> {
    const publicApiBaseUrl = this.configService
      .get<string>('nowpayments.publicApiBaseUrl')
      ?.trim()
      .replace(/\/+$/, '');

    if (!publicApiBaseUrl) {
      return {
        outcome: 'REJECTED',
        failureCode: 'CONFIG_MISSING',
        failureMessage:
          'PUBLIC_API_BASE_URL is not configured; cannot build an IPN callback URL.',
      };
    }

    // NOWPayments requires a fiat reference price even when pay_amount is set.
    // The estimate is informational; pay_amount remains the merchant's exact crypto input.
    const versionedApiBaseUrl = publicApiBaseUrl.endsWith('/v1')
      ? publicApiBaseUrl
      : `${publicApiBaseUrl}/v1`;
    let priceAmount: string;
    try {
      const estimate = await this.client.getUsdEstimate(input.providerCurrency);
      if (
        estimate.currency_from.toLowerCase() !== 'usd' ||
        !new Prisma.Decimal(estimate.amount_from).equals(1) ||
        estimate.currency_to.toLowerCase() !==
          input.providerCurrency.toLowerCase()
      ) {
        return {
          outcome: 'REJECTED',
          failureCode: 'INVALID_PRICE_REFERENCE',
          failureMessage:
            'NOWPayments returned a price estimate for a different currency pair.',
        };
      }

      const cryptoPerUsd = new Prisma.Decimal(estimate.estimated_amount);
      if (!cryptoPerUsd.isPositive()) {
        return {
          outcome: 'REJECTED',
          failureCode: 'INVALID_PRICE_REFERENCE',
          failureMessage: 'NOWPayments returned a non-positive USD estimate.',
        };
      }

      priceAmount = new Prisma.Decimal(input.requestedAmount)
        .div(cryptoPerUsd)
        .toDecimalPlaces(18, Prisma.Decimal.ROUND_HALF_UP)
        .toFixed();
      if (!new Prisma.Decimal(priceAmount).isPositive()) {
        return {
          outcome: 'REJECTED',
          failureCode: 'INVALID_PRICE_REFERENCE',
          failureMessage:
            'The requested crypto amount is too small to produce a provider price reference.',
        };
      }
      if (!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/.test(priceAmount)) {
        return {
          outcome: 'REJECTED',
          failureCode: 'INVALID_PRICE_REFERENCE',
          failureMessage:
            'NOWPayments USD price reference is outside the supported decimal range.',
        };
      }
    } catch (error) {
      this.logger.warn(
        'Could not obtain a NOWPayments USD price reference.',
        error instanceof Error ? error.stack : undefined,
      );
      return {
        outcome: 'REJECTED',
        failureCode: 'PRICE_REFERENCE_UNAVAILABLE',
        failureMessage:
          'NOWPayments could not provide the USD reference required to create a payment.',
      };
    }

    let created: NowPaymentsPaymentResponse;
    try {
      created = await this.client.createPayment({
        priceAmount,
        priceCurrency: 'usd',
        payAmount: input.requestedAmount,
        payCurrency: input.providerCurrency,
        orderId: input.attemptReference,
        orderDescription: `Solaris payment ${input.transactionReference}`,
        ipnCallbackUrl: `${versionedApiBaseUrl}/provider-callbacks/nowpayments`,
      });
    } catch (error) {
      this.logger.warn(
        'NOWPayments payment creation did not return a usable response.',
        error instanceof Error ? error.stack : undefined,
      );
      return {
        outcome: 'UNKNOWN',
        failureCode: 'PROVIDER_REQUEST_FAILED',
        failureMessage:
          'NOWPayments did not return a usable response for payment creation.',
      };
    }

    const payAmount = formatCryptoAmount(
      new Prisma.Decimal(created.pay_amount).toFixed(),
    );
    await this.databaseService.cryptoPaymentDetail.update({
      where: { transactionId: input.transactionId },
      data: {
        attemptId: input.attemptReference,
        nowpaymentsPaymentId: created.payment_id,
        payAmount,
        priceCurrency: created.price_currency,
        priceAmount: created.price_amount,
        paymentAddress: created.pay_address,
        lastReportedStatus: created.payment_status,
        invoiceExpiresAt: created.expiration_estimate_date
          ? new Date(created.expiration_estimate_date)
          : null,
      },
    });

    if (
      created.pay_currency.toLowerCase() !==
        input.providerCurrency.toLowerCase() ||
      created.price_currency.toLowerCase() !== 'usd' ||
      !new Prisma.Decimal(payAmount).equals(input.requestedAmount)
    ) {
      return {
        outcome: 'UNKNOWN',
        failureCode: 'PROVIDER_AMOUNT_MISMATCH',
        failureMessage:
          'NOWPayments did not preserve the requested crypto amount and currency; payment requires reconciliation.',
      };
    }

    return {
      outcome: 'ACCEPTED',
      providerReference: created.payment_id,
      paymentAddress: created.pay_address,
      payAmount,
      asset: input.asset,
      network: input.network,
      expiresAt: created.expiration_estimate_date
        ? new Date(created.expiration_estimate_date)
        : null,
    };
  }
}
