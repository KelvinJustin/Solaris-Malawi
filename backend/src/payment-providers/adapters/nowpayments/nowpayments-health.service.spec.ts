import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NowPaymentsApiClient } from './nowpayments-api.client.js';
import { NowPaymentsHealthService } from './nowpayments-health.service.js';

describe('NowPaymentsHealthService', () => {
  const apiClient = {
    getApiStatus: vi.fn(),
  };
  let service: NowPaymentsHealthService;
  let log: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    service = new NowPaymentsHealthService(
      apiClient as unknown as NowPaymentsApiClient,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('logs a healthy status on startup and checks again every minute', async () => {
    apiClient.getApiStatus.mockResolvedValue({ message: 'OK' });

    service.onModuleInit();
    await vi.waitFor(() => {
      expect(log).toHaveBeenCalledWith(
        'NOWPayments API health check succeeded.',
      );
    });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(apiClient.getApiStatus).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('warns when the API reports a non-OK status', async () => {
    apiClient.getApiStatus.mockResolvedValue({
      message: 'Temporarily unavailable',
    });

    service.onModuleInit();
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        'NOWPayments API health check returned: Temporarily unavailable',
      );
    });
  });

  it('logs a failed health request without stopping the monitor', async () => {
    apiClient.getApiStatus.mockRejectedValue(new Error('Network unavailable'));

    service.onModuleInit();
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        'NOWPayments API health check failed.',
        expect.stringContaining('Network unavailable'),
      );
    });

    expect(apiClient.getApiStatus).toHaveBeenCalledTimes(1);
  });
});
