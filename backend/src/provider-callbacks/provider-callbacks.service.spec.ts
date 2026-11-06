import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  PaymentAttemptStatus,
  PaymentProvider,
  PaymentStatus,
} from '../generated/prisma/enums.js';
import { DatabaseService } from '../database/database.service.js';
import { ProviderCallbackStatus } from './dto/provider-callback.dto.js';
import { ProviderCallbacksService } from './provider-callbacks.service.js';

describe('ProviderCallbacksService', () => {
  let service: ProviderCallbacksService;

  const databaseService = {
    $transaction: vi.fn(),
  };

  const transactionClient = {
    paymentAttempt: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    paymentTransaction: {
      updateMany: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.SIGNING_SECRET = 'local-development-secret';
    process.env.NODE_ENV = 'test';

    databaseService.$transaction.mockImplementation(async (callback) => {
      return callback(transactionClient);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderCallbacksService,
        {
          provide: DatabaseService,
          useValue: databaseService,
        },
      ],
    }).compile();

    service = module.get<ProviderCallbacksService>(ProviderCallbacksService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('accepts a valid provider callback and finalizes the payment attempt', async () => {
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

    const rawBody = Buffer.from(JSON.stringify(body));
    const timestamp = String(Date.now());
    const signature = createHmac('sha256', 'local-development-secret')
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');

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
        }),
      }),
    );
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

    const rawBody = Buffer.from(JSON.stringify(body));
    const timestamp = String(Date.now());
    const signature = createHmac('sha256', 'local-development-secret')
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');

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

  it('rejects callbacks with an invalid signature', async () => {
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

    await expect(
      service.handleCallback({
        body: body as any,
        rawBody: Buffer.from(JSON.stringify(body)),
        timestamp: String(Date.now()),
        signature: 'deadbeef',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
