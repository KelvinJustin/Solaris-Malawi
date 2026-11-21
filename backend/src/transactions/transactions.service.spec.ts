import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  AccountStatus,
  CheckoutSessionStatus,
  PaymentStatus,
  FeeType,
  PaymentType,
  PaymentProvider,
} from '../generated/prisma/enums.js';
import { Prisma } from '../generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { PaymentProviderRegistry } from '../payment-providers/registry/payment-provider.registry.js';
import { CheckoutTokenService } from './checkout-token.service.js';
import { FeePolicyService } from '../ledger/fee-policy.service.js';
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
    feePolicy: {
      findFirst: vi.fn(),
    },
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

    databaseService.$transaction.mockImplementation(async (callback) => callback(transactionClient));
    transactionClient.feePolicy.findFirst.mockImplementation(({ where }) =>
      where.merchantId === null
        ? {
            id: 'fee-policy-zero',
            merchantId: null,
            type: FeeType.ZERO,
            percentageBps: 0,
            fixedAmountTambala: 0n,
            currency: 'MWK',
            version: 1,
          }
        : null,
    );

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
        FeePolicyService,
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

  it('requires an idempotency key before creating a payment', async () => {
    await expect(
      service.create('merchant-123', '   ', {
        amountTambala: 2500,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(databaseService.merchantProfile.findUnique).not.toHaveBeenCalled();
  });

  it('rejects payment creation for merchants whose profile is not approved', async () => {
    databaseService.merchantProfile.findUnique.mockResolvedValue({
      accountStatus: AccountStatus.PENDING_SUBMISSION,
    });

    await expect(
      service.create('merchant-123', 'idem-key', {
        amountTambala: 2500,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
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
      paymentType: PaymentType.MWK,
      provider: null,
      mwkDetail: { amountTambala: 2500, currency: 'MWK' },
      cryptoDetail: null,
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
        paymentType: PaymentType.MWK,
        customerPhone: '+265991234567',
        description: 'Coffee order',
        merchantReference: 'order-42',
        idempotencyKey: 'idem-key',
        status: PaymentStatus.CREATED,
        mwkDetail: {
          create: expect.objectContaining({
            amountTambala: 2500,
            currency: 'MWK',
            feeTambala: 0n,
            merchantNetTambala: 2500n,
            feeType: FeeType.ZERO,
            feePercentageBps: 0,
            feeFixedTambala: 0n,
            feePolicyId: 'fee-policy-zero',
            feePolicyVersion: 1,
          }),
        },
      }),
      include: { mwkDetail: true, cryptoDetail: true },
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

  it('reuses the same checkout response when the idempotency key is reused with identical payload data', async () => {
    databaseService.merchantProfile.findUnique.mockResolvedValue({
      accountStatus: AccountStatus.APPROVED,
    });
    databaseService.paymentTransaction.findUnique.mockResolvedValue({
      publicReference: 'sp_abc123',
      status: PaymentStatus.CREATED,
      paymentType: PaymentType.MWK,
      provider: null,
      customerPhone: '+265991234567',
      description: 'Coffee order',
      merchantReference: 'order-42',
      mwkDetail: { amountTambala: 2500, currency: 'MWK' },
      cryptoDetail: null,
      checkoutSessions: [
        {
          tokenEncrypted: 'encrypted-token',
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
    });

    checkoutTokenService.decryptToken.mockReturnValue('checkout-token');

    await expect(
      service.create('merchant-123', 'idem-key', {
        amountTambala: 2500,
        customerPhone: '+265991234567',
        description: 'Coffee order',
        merchantReference: 'order-42',
      }),
    ).resolves.toMatchObject({
      publicReference: 'sp_abc123',
      status: PaymentStatus.CREATED,
      amountTambala: 2500,
      currency: 'MWK',
      checkout_url: 'https://checkout.example.com/checkout/checkout-token',
    });

    expect(transactionClient.paymentTransaction.create).not.toHaveBeenCalled();
  });

  it('rejects a reused idempotency key with different payment details', async () => {
    databaseService.merchantProfile.findUnique.mockResolvedValue({
      accountStatus: AccountStatus.APPROVED,
    });
    databaseService.paymentTransaction.findUnique.mockResolvedValue({
      publicReference: 'sp_abc123',
      status: PaymentStatus.CREATED,
      paymentType: PaymentType.MWK,
      provider: null,
      customerPhone: '+265991234567',
      description: 'Original coffee order',
      merchantReference: 'order-42',
      mwkDetail: { amountTambala: 2500, currency: 'MWK' },
      cryptoDetail: null,
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

  it('returns checkout metadata for a valid active session and exposes canPay when the payment is still created', async () => {
    checkoutTokenService.hashToken.mockReturnValue('token-hash');
    databaseService.checkoutSession.findUnique.mockResolvedValue({
      id: 'session-1',
      status: CheckoutSessionStatus.ACTIVE,
      expiresAt: new Date(Date.now() + 60_000),
      transaction: {
        publicReference: 'sp_abc123',
        paymentType: PaymentType.MWK,
        mwkDetail: { amountTambala: 2500, currency: 'MWK' },
        cryptoDetail: null,
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

  it('marks expired checkout links as expired and rejects them', async () => {
    checkoutTokenService.hashToken.mockReturnValue('token-hash');
    databaseService.checkoutSession.findUnique.mockResolvedValue({
      id: 'session-1',
      status: CheckoutSessionStatus.ACTIVE,
      expiresAt: new Date(Date.now() - 1000),
      transaction: {
        publicReference: 'sp_abc123',
        paymentType: PaymentType.MWK,
        mwkDetail: { amountTambala: 2500, currency: 'MWK' },
        cryptoDetail: null,
        description: 'Coffee order',
        status: PaymentStatus.CREATED,
      },
    });
    databaseService.checkoutSession.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.getCheckout('checkout-token')).rejects.toBeInstanceOf(NotFoundException);
    expect(databaseService.checkoutSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'session-1',
          status: CheckoutSessionStatus.ACTIVE,
        },
        data: { status: CheckoutSessionStatus.EXPIRED },
      }),
    );
  });

  it('returns only public transaction fields for the owning merchant', async () => {
    const storedTransaction = {
      publicReference: 'sp_123',
      paymentType: PaymentType.MWK,
      mwkDetail: { amountTambala: 2500, currency: 'MWK' },
      cryptoDetail: null,
      status: PaymentStatus.SUCCEEDED,
      provider: 'TEST',
      description: 'Coffee order',
      merchantReference: 'order-42',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      processedAt: new Date('2025-01-01T00:01:00.000Z'),
    };
    databaseService.paymentTransaction.findFirst.mockResolvedValue(storedTransaction);

    await expect(service.findOne('merchant-123', 'sp_123')).resolves.toEqual({
      publicReference: 'sp_123',
      amountTambala: 2500,
      currency: 'MWK',
      status: PaymentStatus.SUCCEEDED,
      provider: 'TEST',
      description: 'Coffee order',
      merchantReference: 'order-42',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      processedAt: new Date('2025-01-01T00:01:00.000Z'),
    });
    expect(databaseService.paymentTransaction.findFirst).toHaveBeenCalledWith({
      where: { publicReference: 'sp_123', merchantId: 'merchant-123' },
      select: {
        publicReference: true,
        paymentType: true,
        mwkDetail: { select: { amountTambala: true, currency: true } },
        cryptoDetail: {
          select: { asset: true, network: true, requestedAmount: true },
        },
        status: true,
        provider: true,
        description: true,
        merchantReference: true,
        createdAt: true,
        processedAt: true,
      },
    });
  });

  it('creates crypto-native transactions from the exact decimal input without an MWK fee snapshot', async () => {
    databaseService.merchantProfile.findUnique.mockResolvedValue({
      accountStatus: AccountStatus.APPROVED,
    });
    databaseService.paymentTransaction.findUnique.mockResolvedValue(null);
    transactionClient.paymentTransaction.create.mockResolvedValue({
      id: 'crypto-txn-1',
      publicReference: 'sp_crypto123',
      status: PaymentStatus.CREATED,
      paymentType: PaymentType.CRYPTO,
      provider: PaymentProvider.NOWPAYMENTS,
      customerPhone: null,
      description: null,
      merchantReference: null,
      mwkDetail: null,
      cryptoDetail: {
        asset: 'USDT',
        network: 'TRC20',
        requestedAmount: new Prisma.Decimal('10.123456789012345678'),
      },
    });

    await expect(
      service.create('merchant-123', 'crypto-key', {
        paymentType: PaymentType.CRYPTO,
        provider: PaymentProvider.NOWPAYMENTS,
        asset: 'usdt',
        network: 'trc20',
        amount: '10.123456789012345678',
      }),
    ).resolves.toMatchObject({
      publicReference: 'sp_crypto123',
      paymentType: PaymentType.CRYPTO,
      provider: PaymentProvider.NOWPAYMENTS,
      asset: 'USDT',
      network: 'TRC20',
      amount: '10.123456789012345678',
    });

    expect(transactionClient.feePolicy.findFirst).not.toHaveBeenCalled();
    expect(transactionClient.paymentTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentType: PaymentType.CRYPTO,
          provider: PaymentProvider.NOWPAYMENTS,
          cryptoDetail: {
            create: {
              asset: 'USDT',
              network: 'TRC20',
              requestedAmount: '10.123456789012345678',
              providerCurrency: 'usdttrc20',
            },
          },
        }),
      }),
    );
    expect(transactionClient.checkoutSession.create).toHaveBeenCalled();
  });

  it('rejects unsupported crypto pairs before persisting a transaction', async () => {
    databaseService.merchantProfile.findUnique.mockResolvedValue({
      accountStatus: AccountStatus.APPROVED,
    });

    await expect(
      service.create('merchant-123', 'crypto-key', {
        paymentType: PaymentType.CRYPTO,
        provider: PaymentProvider.NOWPAYMENTS,
        asset: 'USDT',
        network: 'UNKNOWN',
        amount: '1.00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transactionClient.paymentTransaction.create).not.toHaveBeenCalled();
  });

  it('throws when a merchant asks for a missing transaction by public reference', async () => {
    databaseService.paymentTransaction.findFirst.mockResolvedValue(null);

    await expect(service.findOne('merchant-123', 'sp_missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});