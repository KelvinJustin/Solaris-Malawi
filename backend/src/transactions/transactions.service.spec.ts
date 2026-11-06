import {
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';

import { AccountStatus, CheckoutSessionStatus, PaymentStatus } from '../generated/prisma/enums.js';
import { DatabaseService } from '../database/database.service.js';
import { PaymentProviderRegistry } from '../payment-providers/registry/payment-provider.registry.js';
import { CheckoutTokenService } from './checkout-token.service.js';
import { TransactionsService } from './transactions.service.js';

describe('TransactionsService', () => {
  let service: TransactionsService;

  const checkoutTokenService = {
    createToken: vi.fn(),
    hashToken: vi.fn(),
    decryptToken: vi.fn(),
  };

  const databaseService = {
    merchantProfile: {
      findUnique: vi.fn(),
    },
    paymentTransaction: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    checkoutSession: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const transactionClient = {
    paymentTransaction: {
      create: vi.fn(),
    },
    checkoutSession: {
      create: vi.fn(),
    },
  };

  const configService = {
    get: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    databaseService.$transaction.mockImplementation(async (callback) => {
      return callback(transactionClient);
    });

    configService.get.mockImplementation((key: string) => {
      if (key === 'CHECKOUT_BASE_URL') {
        return 'https://checkout.example.com';
      }
      if (key === 'NODE_ENV') {
        return 'test';
      }
      return undefined;
    });

    checkoutTokenService.createToken.mockReturnValue({
      token: 'checkout-token',
      tokenHash: 'token-hash',
      tokenEncrypted: 'encrypted-token',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        {
          provide: DatabaseService,
          useValue: databaseService,
        },
        {
          provide: CheckoutTokenService,
          useValue: checkoutTokenService,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
        {
          provide: PaymentProviderRegistry,
          useValue: { get: vi.fn() },
        },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('requires an idempotency key before creating a payment', async () => {
    await expect(
      service.create('merchant-123', '', {
        amountTambala: 2500,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(databaseService.merchantProfile.findUnique).not.toHaveBeenCalled();
  });

  it('creates a payment and checkout session for an approved merchant', async () => {
    databaseService.merchantProfile.findUnique.mockResolvedValue({
      accountStatus: AccountStatus.APPROVED,
    });
    databaseService.paymentTransaction.findUnique.mockResolvedValue(null);

    transactionClient.paymentTransaction.create.mockResolvedValue({
      id: 'txn-1',
      publicReference: 'sp_abc123',
      status: PaymentStatus.CREATED,
      amountTambala: 2500,
      currency: 'MWK',
    });

    const result = await service.create('merchant-123', 'idem-key', {
      amountTambala: 2500,
      customerPhone: '+265991234567',
      description: 'Coffee order',
      merchantReference: 'order-42',
    });

    expect(databaseService.merchantProfile.findUnique).toHaveBeenCalledWith({
      where: { merchantId: 'merchant-123' },
      select: { accountStatus: true },
    });

    expect(transactionClient.paymentTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: 'merchant-123',
        amountTambala: 2500,
        currency: 'MWK',
        customerPhone: '+265991234567',
        description: 'Coffee order',
        merchantReference: 'order-42',
        idempotencyKey: 'idem-key',
        status: PaymentStatus.CREATED,
      }),
    });

    expect(transactionClient.checkoutSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transactionId: 'txn-1',
        tokenHash: 'token-hash',
        tokenEncrypted: 'encrypted-token',
        status: CheckoutSessionStatus.ACTIVE,
      }),
    });

    expect(result).toMatchObject({
      publicReference: 'sp_abc123',
      status: PaymentStatus.CREATED,
      amountTambala: 2500,
      currency: 'MWK',
      checkout_url: 'https://checkout.example.com/checkout/checkout-token',
    });
    expect(result.expires_at).toBeInstanceOf(Date);
  });

  it('rejects a reused idempotency key with different payment details', async () => {
    databaseService.merchantProfile.findUnique.mockResolvedValue({
      accountStatus: AccountStatus.APPROVED,
    });
    databaseService.paymentTransaction.findUnique.mockResolvedValue({
      amountTambala: 2500,
      currency: 'MWK',
      customerPhone: '+265991234567',
      description: 'Original coffee order',
      merchantReference: 'order-42',
      checkoutSessions: [],
    });

    await expect(
      service.create('merchant-123', 'idem-key', {
        amountTambala: 5000,
        customerPhone: '+265991234567',
        description: 'Coffee order',
        merchantReference: 'order-42',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns the checkout payload for a valid session', async () => {
    checkoutTokenService.hashToken.mockReturnValue('token-hash');
    databaseService.checkoutSession.findUnique.mockResolvedValue({
      id: 'session-1',
      status: CheckoutSessionStatus.ACTIVE,
      expiresAt: new Date(Date.now() + 60_000),
      transaction: {
        publicReference: 'sp_abc123',
        amountTambala: 2500,
        currency: 'MWK',
        description: 'Coffee order',
        status: PaymentStatus.CREATED,
      },
    });

    await expect(service.getCheckout('checkout-token')).resolves.toEqual({
      reference: 'sp_abc123',
      amountTambala: 2500,
      currency: 'MWK',
      description: 'Coffee order',
      status: PaymentStatus.CREATED,
      canPay: true,
    });
  });

  it('throws when a merchant asks for a missing transaction', async () => {
    databaseService.paymentTransaction.findFirst.mockResolvedValue(null);

    await expect(service.findOne('merchant-123', 'sp_missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});