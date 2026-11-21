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
      new Response(
        '{"payment_id":12345,"payment_status":"waiting","pay_address":"wallet","price_amount":1.2,"price_currency":"usd","pay_amount":0.000120000000000001,"pay_currency":"btc","order_id":"attempt-1","created_at":"2026-01-01T00:00:00.000Z","updated_at":"2026-01-01T00:00:00.000Z"}',
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new NowPaymentsApiClient(configService);

    const response = await client.createPayment({
      priceAmount: '1.2',
      priceCurrency: 'usd',
      payAmount: '0.000120000000000001',
      payCurrency: 'btc',
      orderId: 'attempt-1',
      orderDescription: 'Solaris payment',
      ipnCallbackUrl:
        'https://api.solaris.example/v1/provider-callbacks/nowpayments',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.example.test/v1/payment',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'x-api-key': 'test-api-key',
          'Content-Type': 'application/json',
        },
        body: '{"price_amount":1.2,"price_currency":"usd","pay_amount":0.000120000000000001,"pay_currency":"btc","order_id":"attempt-1","order_description":"Solaris payment","ipn_callback_url":"https://api.solaris.example/v1/provider-callbacks/nowpayments"}',
      }),
    );
    expect(response).toMatchObject({
      payment_id: '12345',
      price_amount: '1.2',
      pay_amount: '0.000120000000000001',
    });
  });

  it('requests a provider-side USD reference estimate for a crypto amount', async () => {
    const configService = {
      get: vi.fn((key: string) =>
        key === 'nowpayments.apiKey'
          ? 'test-api-key'
          : 'https://sandbox.example.test/v1',
      ),
    } as unknown as ConfigService;
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          '{"currency_from":"usd","amount_from":1,"currency_to":"btc","estimated_amount":0.0001}',
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new NowPaymentsApiClient(configService);

    await expect(client.getUsdEstimate('btc')).resolves.toMatchObject({
      currency_from: 'usd',
      amount_from: '1',
      currency_to: 'btc',
      estimated_amount: '0.0001',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.example.test/v1/estimate?amount=1&currency_from=usd&currency_to=btc',
      expect.objectContaining({ method: 'GET' }),
    );
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

    await expect(client.getPaymentStatus('np-payment-1')).rejects.toThrow(
      'NOWPayments rejected the request (400).',
    );
  });
});
