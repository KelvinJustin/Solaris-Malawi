import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NowPaymentsApiClient } from './nowpayments-api.client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('NowPaymentsApiClient', () => {
  it('sends authenticated payment creation requests to the configured endpoint', async () => {
    const configValues: Record<string, string> = {
      'nowpayments.apiKey': 'test-api-key',
      'nowpayments.baseUrl': 'https://sandbox.example.test/v1',
    };
    const configService = {
      get: vi.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ payment_id: 'np-payment-1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new NowPaymentsApiClient(configService);

    const response = await client.createPayment({
      priceAmount: 7,
      priceCurrency: 'usd',
      payCurrency: 'btc',
      orderId: 'attempt-1',
      orderDescription: 'Solaris payment',
      ipnCallbackUrl: 'https://api.solaris.example/v1/webhooks/nowpayments',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.example.test/v1/payment',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'x-api-key': 'test-api-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          price_amount: 7,
          price_currency: 'usd',
          pay_currency: 'btc',
          order_id: 'attempt-1',
          order_description: 'Solaris payment',
          ipn_callback_url:
            'https://api.solaris.example/v1/webhooks/nowpayments',
        }),
      }),
    );
    expect(response).toEqual({ payment_id: 'np-payment-1' });
  });

  it('rejects provider HTTP errors', async () => {
    const configService = {
      get: vi.fn((key: string) =>
        key === 'nowpayments.apiKey'
          ? 'test-api-key'
          : 'https://sandbox.example.test/v1',
      ),
    } as unknown as ConfigService;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'invalid request' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const client = new NowPaymentsApiClient(configService);

    await expect(
      client.getPaymentStatus('np-payment-1'),
    ).rejects.toThrow('NOWPayments rejected the request (400).');
  });
});
