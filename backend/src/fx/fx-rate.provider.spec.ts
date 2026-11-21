import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveFxRateProvider } from './fx-rate.provider.js';

const apiBaseUrl = 'https://rates.example.test/v6/latest';
const ratesPayload = {
  result: 'success',
  time_last_update_utc: 'Fri, 21 Nov 2026 00:00:01 +0000',
  rates: { USD: 0.0007, EUR: 0.00064 },
};

function createConfigService() {
  const values: Record<string, string | number> = {
    'fx.apiBaseUrl': apiBaseUrl,
    'fx.pollIntervalMs': 15_000,
    'nowpayments.settlementPriceCurrency': 'usd',
  };
  return {
    get: vi.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LiveFxRateProvider', () => {
  it('fetches and caches an MWK-to-target quote', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(ratesPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new LiveFxRateProvider(createConfigService());

    const quote = await provider.getRate('USD');
    const cachedQuote = await provider.getRate('usd');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${apiBaseUrl}/MWK`,
      { signal: expect.any(AbortSignal) },
    );
    expect(quote).toEqual({
      fromCurrency: 'MWK',
      toCurrency: 'usd',
      rate: '0.0007',
      capturedAt: expect.any(Date),
    });
    expect(cachedQuote).toEqual(quote);
  });

  it('coalesces concurrent cold-cache requests into one fetch', async () => {
    let resolveResponse!: (response: Response) => void;
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(responsePromise);
    vi.stubGlobal('fetch', fetchMock);
    const provider = new LiveFxRateProvider(createConfigService());

    const first = provider.getRate('usd');
    const second = provider.getRate('eur');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveResponse(
      new Response(JSON.stringify(ratesPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { rate: '0.0007', toCurrency: 'usd' },
      { rate: '0.00064', toCurrency: 'eur' },
    ]);
  });

  it('fails clearly when a cold cache cannot be populated', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new LiveFxRateProvider(createConfigService());

    await expect(provider.getRate('usd')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
