import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  PaymentAttemptStatus,
  PaymentProvider,
  PaymentStatus,
} from '../generated/prisma/enums.js';
import { DatabaseService } from '../database/database.service.js';
import { CryptoLedgerPostingService } from '../ledger/crypto-ledger-posting.service.js';
import { LedgerPostingService } from '../ledger/ledger-posting.service.js';
import { ProviderCallbackStatus } from './dto/provider-callback.dto.js';
import { ProviderCallbacksService } from './provider-callbacks.service.js';

describe('ProviderCallbacksService', () => {
  let service: ProviderCallbacksService;

  const databaseService = {
    $transaction: vi.fn(),
    cryptoPaymentDetail: {
      findUnique: vi.fn(),
    },
    cryptoPaymentIpnEvent: {
      create: vi.fn(),
    },
  };

  const ledgerPostingService = {
    postSuccessfulPayment: vi.fn(),
  };

  const cryptoLedgerPostingService = {
    postSuccessfulCryptoPayment: vi.fn(),
  };

  const configService = {
    getOrThrow: vi.fn((key: string) =>
      key === 'nowpayments.cryptoFeeBps' ? 250 : undefined,
    ),
  };

  const transactionClient = {
    cryptoPaymentDetail: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    paymentAttempt: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    paymentTransaction: {
      updateMany: vi.fn(),
    },
  };

  const makeSignedCallback = (body: Record<string, unknown>, timestamp = String(Date.now())) => {
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = createHmac('sha256', 'local-development-secret')
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');

    return { rawBody, timestamp, signature };
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    ledgerPostingService.postSuccessfulPayment.mockResolvedValue({});
    process.env.SIGNING_SECRET = 'local-development-secret';
    process.env.NODE_ENV = 'test';

    databaseService.$transaction.mockImplementation(async (callback) => callback(transactionClient));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderCallbacksService,
        {
          provide: LedgerPostingService,
          useValue: ledgerPostingService,
        },
        {
          provide: DatabaseService,
          useValue: databaseService,
        },
        {
          provide: CryptoLedgerPostingService,
          useValue: cryptoLedgerPostingService,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    }).compile();

    service = module.get<ProviderCallbacksService>(ProviderCallbacksService);
  });

  it('accepts a valid successful callback and finalizes the payment attempt', async () => {
    const body = {
      event: 'payment.updated',
      providerReference: 'provider-ref-1',
      transactionReference: 'txn-123',
      attemptReference: 'attempt-123',
      amount: 25,
      currency: 'MWK',
      provider: PaymentProvider.TEST,
      status: ProviderCallbackStatus.SUCCESSFUL,
      occurredAt: '2025-01-01T00:00:00.000Z',
    };

    const { rawBody, timestamp, signature } = makeSignedCallback(body);

    transactionClient.paymentAttempt.findUnique.mockResolvedValue({
      id: 'attempt-123',
      status: PaymentAttemptStatus.PROCESSING,
      provider: PaymentProvider.TEST,
      providerReference: null,
      transaction: {
        id: 'txn-123',
        merchantId: 'merchant-123',
        publicReference: 'txn-123',
        provider: PaymentProvider.TEST,
        providerReference: null,
        amountTambala: 2500,
        feeTambala: 0n,
        merchantNetTambala: 2500n,
        currency: 'MWK',
        status: PaymentStatus.PROCESSING,
      },
    });
    transactionClient.paymentAttempt.updateMany.mockResolvedValue({ count: 1 });
    transactionClient.paymentTransaction.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.handleCallback({
        body: body as any,
        rawBody,
        timestamp,
        signature,
      }),
    ).resolves.toEqual({ received: true, duplicate: false });

    expect(transactionClient.paymentAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'attempt-123' }),
        data: expect.objectContaining({
          status: PaymentAttemptStatus.SUCCEEDED,
          providerReference: 'provider-ref-1',
        }),
      }),
    );

    expect(transactionClient.paymentTransaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'txn-123' }),
        data: expect.objectContaining({
          status: PaymentStatus.SUCCEEDED,
          providerReference: 'provider-ref-1',
        }),
      }),
    );
    expect(ledgerPostingService.postSuccessfulPayment).toHaveBeenCalledWith(
      transactionClient,
      expect.objectContaining({
        paymentId: 'txn-123',
        merchantId: 'merchant-123',
        provider: PaymentProvider.TEST,
        amountTambala: 2500n,
        feeTambala: 0n,
        merchantNetTambala: 2500n,
        source: 'CALLBACK',
      }),
    );
  });

  it('propagates ledger failures so payment and attempt updates roll back together', async () => {
    const body = {
      event: 'payment.updated',
      providerReference: 'provider-ref-1',
      transactionReference: 'txn-123',
      attemptReference: 'attempt-123',
      amount: 25,
      currency: 'MWK',
      provider: PaymentProvider.TEST,
      status: ProviderCallbackStatus.SUCCESSFUL,
      occurredAt: '2025-01-01T00:00:00.000Z',
    };
    const { rawBody, timestamp, signature } = makeSignedCallback(body);
    let rolledBack = false;
    databaseService.$transaction.mockImplementation(async (callback) => {
      try {
        return await callback(transactionClient);
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    });
    transactionClient.paymentAttempt.findUnique.mockResolvedValue({
      id: 'attempt-123',
      status: PaymentAttemptStatus.PROCESSING,
      provider: PaymentProvider.TEST,
      providerReference: null,
      transaction: {
        id: 'txn-123',
        merchantId: 'merchant-123',
        publicReference: 'txn-123',
        provider: PaymentProvider.TEST,
        providerReference: null,
        amountTambala: 2500,
        feeTambala: 0n,
        merchantNetTambala: 2500n,
        currency: 'MWK',
        status: PaymentStatus.PROCESSING,
      },
    });
    transactionClient.paymentAttempt.updateMany.mockResolvedValue({ count: 1 });
    transactionClient.paymentTransaction.updateMany.mockResolvedValue({ count: 1 });
    ledgerPostingService.postSuccessfulPayment.mockRejectedValue(new Error('ledger unavailable'));

    await expect(service.handleCallback({ body: body as any, rawBody, timestamp, signature }))
      .rejects.toThrow('ledger unavailable');

    expect(transactionClient.paymentAttempt.updateMany).toHaveBeenCalled();
    expect(transactionClient.paymentTransaction.updateMany).toHaveBeenCalled();
    expect(rolledBack).toBe(true);
  });

  it('returns duplicate=true for a repeated callback with the same final state', async () => {
    const body = {
      event: 'payment.updated',
      providerReference: 'provider-ref-1',
      transactionReference: 'txn-123',
      attemptReference: 'attempt-123',
      amount: 25,
      currency: 'MWK',
      provider: PaymentProvider.TEST,
      status: ProviderCallbackStatus.SUCCESSFUL,
      occurredAt: '2025-01-01T00:00:00.000Z',
    };

    const { rawBody, timestamp, signature } = makeSignedCallback(body);

    transactionClient.paymentAttempt.findUnique.mockResolvedValue({
      id: 'attempt-123',
      status: PaymentAttemptStatus.SUCCEEDED,
      provider: PaymentProvider.TEST,
      providerReference: 'provider-ref-1',
      transaction: {
        id: 'txn-123',
        publicReference: 'txn-123',
        provider: PaymentProvider.TEST,
        providerReference: 'provider-ref-1',
        amountTambala: 2500,
        currency: 'MWK',
        status: PaymentStatus.SUCCEEDED,
      },
    });

    await expect(
      service.handleCallback({
        body: body as any,
        rawBody,
        timestamp,
        signature,
      }),
    ).resolves.toEqual({ received: true, duplicate: true });

    expect(transactionClient.paymentAttempt.updateMany).not.toHaveBeenCalled();
    expect(transactionClient.paymentTransaction.updateMany).not.toHaveBeenCalled();
    expect(ledgerPostingService.postSuccessfulPayment).not.toHaveBeenCalled();
  });

  it('posts only once for concurrent duplicate success callbacks', async () => {
    const body = {
      event: 'payment.updated',
      providerReference: 'provider-ref-1',
      transactionReference: 'txn-123',
      attemptReference: 'attempt-123',
      amount: 25,
      currency: 'MWK',
      provider: PaymentProvider.TEST,
      status: ProviderCallbackStatus.SUCCESSFUL,
      occurredAt: '2025-01-01T00:00:00.000Z',
    };
    const { rawBody, timestamp, signature } = makeSignedCallback(body);
    const processingRecord = {
      id: 'attempt-123',
      status: PaymentAttemptStatus.PROCESSING,
      provider: PaymentProvider.TEST,
      providerReference: null,
      transaction: {
        id: 'txn-123',
        merchantId: 'merchant-123',
        publicReference: 'txn-123',
        provider: PaymentProvider.TEST,
        providerReference: null,
        amountTambala: 2500,
        feeTambala: 0n,
        merchantNetTambala: 2500n,
        currency: 'MWK',
        status: PaymentStatus.PROCESSING,
      },
    };
    const succeededRecord = {
      ...processingRecord,
      status: PaymentAttemptStatus.SUCCEEDED,
      providerReference: 'provider-ref-1',
      transaction: {
        ...processingRecord.transaction,
        status: PaymentStatus.SUCCEEDED,
        providerReference: 'provider-ref-1',
      },
    };
    let lookupCount = 0;
    let attemptFinalized = false;
    let releaseTerminalRead!: () => void;
    const terminalReadReady = new Promise<void>((resolve) => {
      releaseTerminalRead = resolve;
    });
    transactionClient.paymentAttempt.findUnique.mockImplementation(async () => {
      lookupCount += 1;
      if (lookupCount <= 2) return processingRecord;
      await terminalReadReady;
      return succeededRecord;
    });
    transactionClient.paymentAttempt.updateMany.mockImplementation(async () => {
      if (attemptFinalized) return { count: 0 };
      attemptFinalized = true;
      return { count: 1 };
    });
    transactionClient.paymentTransaction.updateMany.mockImplementation(async () => {
      releaseTerminalRead();
      return { count: 1 };
    });

    const results = await Promise.all([
      service.handleCallback({ body: body as any, rawBody, timestamp, signature }),
      service.handleCallback({ body: body as any, rawBody, timestamp, signature }),
    ]);

    expect(results.map((result) => result.duplicate).sort((a, b) => Number(a) - Number(b))).toEqual([false, true]);
    expect(ledgerPostingService.postSuccessfulPayment).toHaveBeenCalledTimes(1);
  });

  it('does not post successful-payment entries for a failed outcome', async () => {
    const body = {
      event: 'payment.updated',
      providerReference: 'provider-ref-1',
      transactionReference: 'txn-123',
      attemptReference: 'attempt-123',
      amount: 25,
      currency: 'MWK',
      provider: PaymentProvider.TEST,
      status: ProviderCallbackStatus.FAILED,
      occurredAt: '2025-01-01T00:00:00.000Z',
      failureCode: 'DECLINED',
    };
    const { rawBody, timestamp, signature } = makeSignedCallback(body);
    transactionClient.paymentAttempt.findUnique.mockResolvedValue({
      id: 'attempt-123',
      status: PaymentAttemptStatus.PROCESSING,
      provider: PaymentProvider.TEST,
      providerReference: null,
      transaction: {
        id: 'txn-123',
        publicReference: 'txn-123',
        provider: PaymentProvider.TEST,
        providerReference: null,
        amountTambala: 2500,
        currency: 'MWK',
        status: PaymentStatus.PROCESSING,
      },
    });
    transactionClient.paymentAttempt.updateMany.mockResolvedValue({ count: 1 });
    transactionClient.paymentTransaction.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.handleCallback({ body: body as any, rawBody, timestamp, signature }))
      .resolves.toEqual({ received: true, duplicate: false });

    expect(ledgerPostingService.postSuccessfulPayment).not.toHaveBeenCalled();
  });

  it('rejects an unknown outcome without posting', async () => {
    const body = {
      event: 'payment.updated',
      providerReference: 'provider-ref-1',
      transactionReference: 'txn-123',
      attemptReference: 'attempt-123',
      amount: 25,
      currency: 'MWK',
      provider: PaymentProvider.TEST,
      status: 'UNKNOWN',
      occurredAt: '2025-01-01T00:00:00.000Z',
    };
    const { rawBody, timestamp, signature } = makeSignedCallback(body);

    await expect(service.handleCallback({ body: body as any, rawBody, timestamp, signature }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(databaseService.$transaction).not.toHaveBeenCalled();
    expect(ledgerPostingService.postSuccessfulPayment).not.toHaveBeenCalled();
  });

  it('rejects unsupported callback events before touching the database', async () => {
    const body = {
      event: 'payment.created',
      providerReference: 'provider-ref-1',
      transactionReference: 'txn-123',
      attemptReference: 'attempt-123',
      amount: 25,
      currency: 'MWK',
      provider: PaymentProvider.TEST,
      status: ProviderCallbackStatus.SUCCESSFUL,
      occurredAt: '2025-01-01T00:00:00.000Z',
    };

    const { rawBody, timestamp, signature } = makeSignedCallback(body);

    await expect(
      service.handleCallback({
        body: body as any,
        rawBody,
        timestamp,
        signature,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transactionClient.paymentAttempt.findUnique).not.toHaveBeenCalled();
  });

  it('rejects stale or malformed callback timestamps', async () => {
    const body = {
      event: 'payment.updated',
      providerReference: 'provider-ref-1',
      transactionReference: 'txn-123',
      attemptReference: 'attempt-123',
      amount: 25,
      currency: 'MWK',
      provider: PaymentProvider.TEST,
      status: ProviderCallbackStatus.SUCCESSFUL,
      occurredAt: '2025-01-01T00:00:00.000Z',
    };

    const { rawBody } = makeSignedCallback(body, String(Date.now() - 10 * 60 * 1000));

    await expect(
      service.handleCallback({
        body: body as any,
        rawBody,
        timestamp: String(Date.now() - 10 * 60 * 1000),
        signature: 'deadbeef',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects invalid callback amounts that cannot be represented as tambala', async () => {
    const body = {
      event: 'payment.updated',
      providerReference: 'provider-ref-1',
      transactionReference: 'txn-123',
      attemptReference: 'attempt-123',
      amount: 25.123,
      currency: 'MWK',
      provider: PaymentProvider.TEST,
      status: ProviderCallbackStatus.SUCCESSFUL,
      occurredAt: '2025-01-01T00:00:00.000Z',
    };

    const { rawBody, timestamp, signature } = makeSignedCallback(body);

    await expect(
      service.handleCallback({
        body: body as any,
        rawBody,
        timestamp,
        signature,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transactionClient.paymentAttempt.findUnique).not.toHaveBeenCalled();
  });

  it('rejects callbacks whose transaction or provider metadata do not match the stored records', async () => {
    const body = {
      event: 'payment.updated',
      providerReference: 'provider-ref-1',
      transactionReference: 'txn-123',
      attemptReference: 'attempt-123',
      amount: 25,
      currency: 'MWK',
      provider: PaymentProvider.TEST,
      status: ProviderCallbackStatus.SUCCESSFUL,
      occurredAt: '2025-01-01T00:00:00.000Z',
    };

    const { rawBody, timestamp, signature } = makeSignedCallback(body);

    transactionClient.paymentAttempt.findUnique.mockResolvedValue({
      id: 'attempt-123',
      status: PaymentAttemptStatus.PROCESSING,
      provider: PaymentProvider.AIRTEL_MONEY,
      providerReference: null,
      transaction: {
        id: 'txn-123',
        publicReference: 'txn-123',
        provider: PaymentProvider.TEST,
        providerReference: null,
        amountTambala: 2500,
        currency: 'MWK',
        status: PaymentStatus.PROCESSING,
      },
    });

    await expect(
      service.handleCallback({
        body: body as any,
        rawBody,
        timestamp,
        signature,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('uses the configured NOWPayments fee and records the actual paid amount', async () => {
    const detail = {
      id: 'crypto-detail-1',
      payCurrency: 'btc',
      actuallyPaidAmount: null,
      attempt: {
        id: 'crypto-attempt-1',
        status: PaymentAttemptStatus.PROCESSING,
        providerReference: 'np-payment-1',
        transaction: {
          id: 'crypto-transaction-1',
          publicReference: 'crypto-ref-1',
          merchantId: 'merchant-1',
          provider: PaymentProvider.NOWPAYMENTS,
          status: PaymentStatus.PROCESSING,
          merchantNetTambala: 1_000_000n,
        },
      },
    };
    const payload = {
      payment_id: 'np-payment-1',
      payment_status: 'finished' as const,
      actually_paid: 0.00012,
    };
    databaseService.cryptoPaymentDetail.findUnique.mockResolvedValue(detail);
    databaseService.cryptoPaymentIpnEvent.create.mockResolvedValue({});
    transactionClient.cryptoPaymentDetail.findUnique.mockResolvedValue(detail);
    transactionClient.cryptoPaymentDetail.update.mockResolvedValue({});
    transactionClient.paymentAttempt.updateMany.mockResolvedValue({ count: 1 });
    transactionClient.paymentTransaction.updateMany.mockResolvedValue({ count: 1 });
    cryptoLedgerPostingService.postSuccessfulCryptoPayment.mockResolvedValue({});

    await expect(service.handleNowPaymentsCallback(payload)).resolves.toEqual({
      received: true,
      duplicate: false,
    });

    expect(cryptoLedgerPostingService.postSuccessfulCryptoPayment).toHaveBeenCalledWith(
      transactionClient,
      expect.objectContaining({
        paymentId: 'crypto-transaction-1',
        actuallyPaidAmount: 0.00012,
        feeBps: 250,
      }),
    );
    expect(transactionClient.cryptoPaymentDetail.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastReportedStatus: 'finished',
          actuallyPaidAmount: 0.00012,
        }),
      }),
    );
  });
});
