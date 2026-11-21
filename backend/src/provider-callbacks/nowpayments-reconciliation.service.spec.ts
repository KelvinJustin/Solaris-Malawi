import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../database/database.service.js';
import { NowPaymentsApiClient } from '../payment-providers/adapters/nowpayments/nowpayments-api.client.js';
import { ProviderCallbacksService } from './provider-callbacks.service.js';
import { NowPaymentsReconciliationService } from './nowpayments-reconciliation.service.js';

describe('NowPaymentsReconciliationService', () => {
  const database = {
    cryptoPaymentDetail: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
  const apiClient = {
    getPaymentStatus: vi.fn(),
  };
  const callbacks = {
    handleReconciledNowPaymentsStatus: vi.fn(),
  };
  const config = {
    get: vi.fn((key: string) =>
      key === 'nowpayments.apiKey' ? 'test-api-key' : undefined,
    ),
  };
  let service: NowPaymentsReconciliationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new NowPaymentsReconciliationService(
      database as unknown as DatabaseService,
      apiClient as unknown as NowPaymentsApiClient,
      callbacks as unknown as ProviderCallbacksService,
      config as unknown as ConfigService,
    );
  });

  it('polls stale payments and applies the authenticated provider status', async () => {
    const candidate = {
      id: 'detail-1',
      nowpaymentsPaymentId: 'np-payment-1',
    };
    const response = {
      payment_id: 'np-payment-1',
      payment_status: 'finished',
      actually_paid: 0.00012,
    };
    database.cryptoPaymentDetail.findMany.mockResolvedValue([candidate]);
    database.cryptoPaymentDetail.update.mockResolvedValue(candidate);
    apiClient.getPaymentStatus.mockResolvedValue(response);
    callbacks.handleReconciledNowPaymentsStatus.mockResolvedValue({
      received: true,
      duplicate: false,
    });

    await service.reconcilePendingPayments();

    expect(apiClient.getPaymentStatus).toHaveBeenCalledWith('np-payment-1');
    expect(
      callbacks.handleReconciledNowPaymentsStatus,
    ).toHaveBeenCalledWith(response);
    expect(database.cryptoPaymentDetail.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'detail-1' },
        data: { updatedAt: expect.any(Date) },
      }),
    );
  });

  it('does not contact NOWPayments when no API key is configured', async () => {
    config.get.mockReturnValue(undefined);

    await service.reconcilePendingPayments();

    expect(database.cryptoPaymentDetail.findMany).not.toHaveBeenCalled();
    expect(apiClient.getPaymentStatus).not.toHaveBeenCalled();
  });
});
