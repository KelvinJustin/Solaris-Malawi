import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentProvider } from '../../../generated/prisma/enums.js';
import { DatabaseService } from '../../../database/database.service.js';
import { NowPaymentsApiClient } from './nowpayments-api.client.js';
import { NowPaymentsProviderAdapter } from './nowpayments-payment-provider.adapter.js';

describe('NowPaymentsProviderAdapter', () => {
  const createPayment = vi.fn();
  const getUsdEstimate = vi.fn();
  const updateCryptoPaymentDetail = vi.fn();
  const configValues: Record<string, string> = {
    'nowpayments.publicApiBaseUrl': 'https://api.solaris.example/',
  };
  const configService = {
    get: vi.fn((key: string) => configValues[key]),
  } as unknown as ConfigService;
  const database = {
    cryptoPaymentDetail: { update: updateCryptoPaymentDetail },
  } as unknown as DatabaseService;
  let adapter: NowPaymentsProviderAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    configValues['nowpayments.publicApiBaseUrl'] =
      'https://api.solaris.example/';
    createPayment.mockResolvedValue({
      payment_id: 'np-payment-1',
      payment_status: 'waiting',
      pay_address: 'wallet-address',
      price_amount: '1.2',
      price_currency: 'usd',
      pay_amount: '0.000120000000000001',
      pay_currency: 'btc',
      order_id: 'attempt-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      network: 'btc',
    });
    getUsdEstimate.mockResolvedValue({
      currency_from: 'usd',
      amount_from: '1',
      currency_to: 'btc',
      estimated_amount: '0.0001',
    });
    updateCryptoPaymentDetail.mockResolvedValue({ id: 'crypto-detail-1' });
    adapter = new NowPaymentsProviderAdapter(
      { createPayment, getUsdEstimate } as unknown as NowPaymentsApiClient,
      configService,
      database,
      PaymentProvider.NOWPAYMENTS,
    );
  });

  it('creates a payment with an exact crypto amount and a provider-side USD reference', async () => {
    const result = await adapter.initiatePayment({
      provider: PaymentProvider.NOWPAYMENTS,
      transactionReference: 'solaris-ref-1',
      attemptReference: 'attempt-1',
      transactionId: 'transaction-1',
      requestedAmount: '0.000120000000000001',
      providerCurrency: 'btc',
      asset: 'BTC',
      network: null,
    });

    expect(createPayment).toHaveBeenCalledWith({
      priceAmount: '1.20000000000001',
      priceCurrency: 'usd',
      payAmount: '0.000120000000000001',
      payCurrency: 'btc',
      orderId: 'attempt-1',
      orderDescription: 'Solaris payment solaris-ref-1',
      ipnCallbackUrl:
        'https://api.solaris.example/v1/provider-callbacks/nowpayments',
    });
    expect(updateCryptoPaymentDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { transactionId: 'transaction-1' },
        data: expect.objectContaining({
          attemptId: 'attempt-1',
          nowpaymentsPaymentId: 'np-payment-1',
          payAmount: '0.000120000000000001',
          priceCurrency: 'usd',
          priceAmount: '1.2',
          paymentAddress: 'wallet-address',
        }),
      }),
    );
    expect(getUsdEstimate).toHaveBeenCalledWith('btc');
    expect(result).toMatchObject({
      outcome: 'ACCEPTED',
      providerReference: 'np-payment-1',
      paymentAddress: 'wallet-address',
      payAmount: '0.000120000000000001',
      asset: 'BTC',
      network: null,
    });
  });

  it('rejects before contacting NOWPayments when the public callback URL is missing', async () => {
    configValues['nowpayments.publicApiBaseUrl'] = '';

    const result = await adapter.initiatePayment({
      provider: PaymentProvider.NOWPAYMENTS,
      transactionReference: 'solaris-ref-2',
      attemptReference: 'attempt-2',
      transactionId: 'transaction-2',
      requestedAmount: '1',
      providerCurrency: 'btc',
      asset: 'BTC',
      network: null,
    });

    expect(result).toMatchObject({
      outcome: 'REJECTED',
      failureCode: 'CONFIG_MISSING',
    });
    expect(createPayment).not.toHaveBeenCalled();
    expect(updateCryptoPaymentDetail).not.toHaveBeenCalled();
  });

  it('moves a provider amount mismatch to reconciliation instead of showing the wrong amount', async () => {
    getUsdEstimate.mockResolvedValue({
      currency_from: 'usd',
      amount_from: '1',
      currency_to: 'usdttrc20',
      estimated_amount: '1',
    });
    createPayment.mockResolvedValue({
      payment_id: 'np-payment-3',
      payment_status: 'waiting',
      pay_address: 'wallet-address',
      price_amount: '1.0001',
      price_currency: 'usd',
      pay_amount: '1.0001',
      pay_currency: 'usdttrc20',
      order_id: 'attempt-3',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const result = await adapter.initiatePayment({
      provider: PaymentProvider.NOWPAYMENTS,
      transactionReference: 'solaris-ref-3',
      attemptReference: 'attempt-3',
      transactionId: 'transaction-3',
      requestedAmount: '1',
      providerCurrency: 'usdttrc20',
      asset: 'USDT',
      network: 'TRC20',
    });

    expect(result).toMatchObject({
      outcome: 'UNKNOWN',
      failureCode: 'PROVIDER_AMOUNT_MISMATCH',
    });
    expect(updateCryptoPaymentDetail).toHaveBeenCalled();
  });
});
