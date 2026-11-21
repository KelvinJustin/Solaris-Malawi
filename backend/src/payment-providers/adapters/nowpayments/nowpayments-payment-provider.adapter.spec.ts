import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentProvider } from '../../../generated/prisma/enums.js';
import { DatabaseService } from '../../../database/database.service.js';
import type { FxRateProvider } from '../../../fx/fx-rate.provider.js';
import { NowPaymentsApiClient } from './nowpayments-api.client.js';
import { NowPaymentsProviderAdapter } from './nowpayments-payment-provider.adapter.js';

describe('NowPaymentsProviderAdapter', () => {
  let client: {
    createPayment: ReturnType<typeof vi.fn>;
  };
  let database: {
    cryptoPaymentDetail: {
      create: ReturnType<typeof vi.fn>;
    };
  };
  let createCryptoPaymentDetail: ReturnType<typeof vi.fn>;
  let getFxRate: ReturnType<typeof vi.fn>;
  let fxRateProvider: FxRateProvider;
  let adapter: NowPaymentsProviderAdapter;

  beforeEach(() => {
    const configValues: Record<string, string | number> = {
      'nowpayments.settlementPriceCurrency': 'usd',
      'nowpayments.maxFxQuoteAgeSeconds': 300,
      'nowpayments.publicApiBaseUrl': 'https://api.solaris.example',
    };
    const configService = {
      get: vi.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;
    client = {
      createPayment: vi.fn().mockResolvedValue({
        payment_id: 'np-payment-1',
        payment_status: 'waiting',
        pay_address: 'wallet-address',
        price_amount: 7,
        price_currency: 'usd',
        pay_amount: 0.00012,
        pay_currency: 'btc',
        order_id: 'attempt-1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        network: 'btc',
      }),
    };
    createCryptoPaymentDetail = vi
      .fn()
      .mockResolvedValue({ id: 'crypto-detail-1' });
    database = {
      cryptoPaymentDetail: {
        create: createCryptoPaymentDetail,
      },
    };
    getFxRate = vi.fn().mockResolvedValue({
        fromCurrency: 'MWK',
        toCurrency: 'usd',
        rate: '0.0007',
        capturedAt: new Date(),
      });
    fxRateProvider = {
      getRate: getFxRate,
    };
    adapter = new NowPaymentsProviderAdapter(
      client as unknown as NowPaymentsApiClient,
      configService,
      database as unknown as DatabaseService,
      fxRateProvider,
      PaymentProvider.NOWPAYMENTS,
    );
  });

  it('converts the MWK amount, creates an invoice, and stores crypto details', async () => {
    const result = await adapter.initiatePayment({
      provider: PaymentProvider.NOWPAYMENTS,
      transactionReference: 'solaris-ref-1',
      attemptReference: 'attempt-1',
      amountTambala: 1_000_000,
      currency: 'MWK',
      payCurrency: 'btc',
      network: 'btc',
    });

    expect(getFxRate.mock.calls).toContainEqual(['usd']);
    expect(client.createPayment.mock.calls).toContainEqual([
      {
        priceAmount: 7,
        priceCurrency: 'usd',
        payCurrency: 'btc',
        orderId: 'attempt-1',
        orderDescription: 'Solaris payment solaris-ref-1',
        ipnCallbackUrl:
          'https://api.solaris.example/v1/provider-callbacks/nowpayments',
      },
    ]);
    expect(createCryptoPaymentDetail.mock.calls).toContainEqual([
      {
        data: expect.objectContaining({
          attemptId: 'attempt-1',
          nowpaymentsPaymentId: 'np-payment-1',
          priceAmount: 7,
          priceCurrency: 'usd',
          fxRateMwkToPriceCurrency: '0.0007',
          paymentAddress: 'wallet-address',
        }),
      },
    ]);
    expect(result).toMatchObject({
      outcome: 'ACCEPTED',
      providerReference: 'np-payment-1',
      paymentAddress: 'wallet-address',
      payAmount: '0.00012',
      payCurrency: 'btc',
      network: 'btc',
    });
  });

  it('does not create an invoice when the quote exceeds the configured age', async () => {
    getFxRate.mockResolvedValue({
      fromCurrency: 'MWK',
      toCurrency: 'usd',
      rate: '0.0007',
      capturedAt: new Date(Date.now() - 301_000),
    });

    const result = await adapter.initiatePayment({
      provider: PaymentProvider.NOWPAYMENTS,
      transactionReference: 'solaris-ref-2',
      attemptReference: 'attempt-2',
      amountTambala: 1_000_000,
      currency: 'MWK',
      payCurrency: 'btc',
      network: 'btc',
    });

    expect(result).toMatchObject({
      outcome: 'REJECTED',
      failureCode: 'FX_QUOTE_STALE',
    });
    expect(client.createPayment.mock.calls).toHaveLength(0);
    expect(createCryptoPaymentDetail.mock.calls).toHaveLength(0);
  });

  it('rejects when the public callback URL is missing', async () => {
    const configService = {
      get: vi.fn((key: string) =>
        key === 'nowpayments.settlementPriceCurrency'
          ? 'usd'
          : key === 'nowpayments.maxFxQuoteAgeSeconds'
            ? 300
            : undefined,
      ),
    } as unknown as ConfigService;
    const adapterWithoutCallbackUrl = new NowPaymentsProviderAdapter(
      client as unknown as NowPaymentsApiClient,
      configService,
      database as unknown as DatabaseService,
      fxRateProvider,
      PaymentProvider.NOWPAYMENTS,
    );

    const result = await adapterWithoutCallbackUrl.initiatePayment({
      provider: PaymentProvider.NOWPAYMENTS,
      transactionReference: 'solaris-ref-3',
      attemptReference: 'attempt-3',
      amountTambala: 1_000_000,
      currency: 'MWK',
      payCurrency: 'btc',
      network: 'btc',
    });

    expect(result).toMatchObject({
      outcome: 'REJECTED',
      failureCode: 'CONFIG_MISSING',
    });
    expect(getFxRate.mock.calls).toHaveLength(0);
  });
});
