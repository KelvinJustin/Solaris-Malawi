import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';

import { TransactionsController } from './transactions.controller.js';
import { TransactionsService } from './transactions.service.js';

describe('TransactionsController', () => {
  let controller: TransactionsController;

  const transactionsService = {
    create: vi.fn(),
    findOne: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [
        {
          provide: TransactionsService,
          useValue: transactionsService,
        },
      ],
    }).compile();

    controller = module.get<TransactionsController>(TransactionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('creates a payment for the authenticated merchant', async () => {
    const dto = {
      amountTambala: 2500,
      description: 'Coffee order',
    };
    const result = {
      publicReference: 'sp_123',
      status: 'CREATED',
      amountTambala: 2500,
      currency: 'MWK',
      checkout_url: 'https://checkout.example.com/checkout/token',
      expires_at: new Date('2025-01-01T00:00:00.000Z'),
    };

    transactionsService.create.mockResolvedValue(result);

    await expect(
      controller.create('merchant-123', 'idem-key', dto as any),
    ).resolves.toEqual(result);

    expect(transactionsService.create).toHaveBeenCalledWith(
      'merchant-123',
      'idem-key',
      dto,
    );
  });

  it('looks up a transaction by public reference for the authenticated merchant', async () => {
    const result = {
      id: 'txn-1',
      publicReference: 'sp_123',
      merchantId: 'merchant-123',
      status: 'CREATED',
    };

    transactionsService.findOne.mockResolvedValue(result);

    await expect(controller.findOne('merchant-123', 'sp_123')).resolves.toEqual(result);
    expect(transactionsService.findOne).toHaveBeenCalledWith('merchant-123', 'sp_123');
  });
});