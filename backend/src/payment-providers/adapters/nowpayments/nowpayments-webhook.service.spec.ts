import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PaymentAttemptStatus,
  PaymentProvider,
  PaymentStatus,
} from '../../../generated/prisma/enums.js';
import { DatabaseService } from '../../../database/database.service.js';
import { LedgerPostingService } from '../../../ledger/ledger-posting.service.js';
import { NowPaymentsWebhookService } from './nowpayments-webhook.service.js';

describe('NowPaymentsWebhookService', () => {
  let service: NowPaymentsWebhookService;
  let database: {
    cryptoPaymentDetail: {
      findUnique: ReturnType<typeof vi.fn>;
    };
    cryptoPaymentIpnEvent: {
      create: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let tx: {
    cryptoPaymentDetail: {
      update: ReturnType<typeof vi.fn>;
    };
    paymentAttempt: {
      updateMany: ReturnType<typeof vi.fn>;
    };
    paymentTransaction: {
      updateMany: ReturnType<typeof vi.fn>;
    };
  };
  let ledgerPosting: {
    postSuccessfulPayment: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    tx = {
      cryptoPaymentDetail: { update: vi.fn() },
      paymentAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      paymentTransaction: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    database = {
      cryptoPaymentDetail: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'crypto-detail-1',
          actuallyPaidAmount: null,
          attempt: {
            id: 'attempt-1',
            transaction: {
              id: 'payment-1',
              publicReference: 'solaris-ref-1',
              merchantId: 'merchant-1',
              provider: PaymentProvider.NOWPAYMENTS,
              amountTambala: 1_000_000,
              feeTambala: 0n,
              merchantNetTambala: 1_000_000n,
              currency: 'MWK',
            },
          },
        }),
      },
      cryptoPaymentIpnEvent: { create: vi.fn() },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };
    ledgerPosting = {
      postSuccessfulPayment: vi.fn(),
    };
    service = new NowPaymentsWebhookService(
      database as unknown as DatabaseService,
      ledgerPosting as unknown as LedgerPostingService,
    );
  });

  it('updates the payment and posts the ledger in the same transaction on finished', async () => {
    await service.handleVerifiedCallback({
      payment_id: 'np-payment-1',
      payment_status: 'finished',
      actually_paid: 0.00012,
    });

    expect(database.cryptoPaymentIpnEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cryptoPaymentDetailId: 'crypto-detail-1',
        reportedStatus: 'finished',
        actuallyPaidAmount: 0.00012,
      }),
    });
    expect(tx.paymentAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'attempt-1',
          status: {
            in: [
              PaymentAttemptStatus.STARTED,
              PaymentAttemptStatus.PROCESSING,
              PaymentAttemptStatus.UNKNOWN,
            ],
          },
        }),
        data: expect.objectContaining({
          status: PaymentAttemptStatus.SUCCEEDED,
          providerReference: 'np-payment-1',
        }),
      }),
    );
    expect(tx.paymentTransaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'payment-1',
          status: {
            in: [
              PaymentStatus.PROCESSING,
              PaymentStatus.PENDING_RECONCILIATION,
            ],
          },
        },
        data: expect.objectContaining({ status: PaymentStatus.SUCCEEDED }),
      }),
    );
    expect(ledgerPosting.postSuccessfulPayment).toHaveBeenCalledWith(tx, {
      paymentId: 'payment-1',
      publicReference: 'solaris-ref-1',
      merchantId: 'merchant-1',
      provider: PaymentProvider.NOWPAYMENTS,
      amountTambala: 1_000_000n,
      feeTambala: 0n,
      merchantNetTambala: 1_000_000n,
      currency: 'MWK',
      source: 'CALLBACK',
    });
    expect(database.$transaction).toHaveBeenCalledOnce();
  });

  it('does not post the ledger for partial payment', async () => {
    await service.handleVerifiedCallback({
      payment_id: 'np-payment-1',
      payment_status: 'partially_paid',
      actually_paid: 0.00005,
    });

    expect(ledgerPosting.postSuccessfulPayment).not.toHaveBeenCalled();
    expect(tx.paymentTransaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PaymentStatus.PENDING_RECONCILIATION,
        }),
      }),
    );
  });

  it('does not post a duplicate when the attempt has already finalized', async () => {
    tx.paymentAttempt.updateMany.mockResolvedValue({ count: 0 });

    await service.handleVerifiedCallback({
      payment_id: 'np-payment-1',
      payment_status: 'finished',
      actually_paid: 0.00012,
    });

    expect(tx.paymentTransaction.updateMany).not.toHaveBeenCalled();
    expect(ledgerPosting.postSuccessfulPayment).not.toHaveBeenCalled();
  });
});
