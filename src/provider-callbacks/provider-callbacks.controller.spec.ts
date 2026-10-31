import {
  BadRequestException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';

import { ProviderCallbacksController } from './provider-callbacks.controller.js';
import { ProviderCallbacksService } from './provider-callbacks.service.js';

describe('ProviderCallbacksController', () => {
  let controller: ProviderCallbacksController;

  const providerCallbacksService = {
    handleCallback: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProviderCallbacksController],
      providers: [
        {
          provide: ProviderCallbacksService,
          useValue: providerCallbacksService,
        },
      ],
    }).compile();

    controller = module.get<ProviderCallbacksController>(ProviderCallbacksController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('forwards the raw body and signature metadata to the service for verification', async () => {
    const body = {
      event: 'payment.updated',
      providerReference: 'provider-ref',
      transactionReference: 'transaction-ref',
      attemptReference: '1d7374b3-2d57-412a-9fe0-4a3a6d482d64',
      amount: 25,
      currency: 'MWK',
      provider: 'TEST',
      status: 'SUCCESSFUL',
      occurredAt: '2025-01-01T00:00:00.000Z',
    } as any;
    const rawBody = Buffer.from(JSON.stringify(body));
    const request = { rawBody } as any;
    const result = { received: true, duplicate: false };

    providerCallbacksService.handleCallback.mockResolvedValue(result);

    await expect(
      controller.handleCallback(
        body,
        request,
        '1736182800123',
        'aabbccddeeff',
      ),
    ).resolves.toEqual(result);

    expect(providerCallbacksService.handleCallback).toHaveBeenCalledWith({
      body,
      rawBody,
      timestamp: '1736182800123',
      signature: 'aabbccddeeff',
    });
  });

  it('rejects callbacks when the raw body is unavailable', async () => {
    const body = {
      event: 'payment.updated',
      providerReference: 'provider-ref',
      transactionReference: 'transaction-ref',
      attemptReference: '1d7374b3-2d57-412a-9fe0-4a3a6d482d64',
      amount: 25,
      currency: 'MWK',
      provider: 'TEST',
      status: 'SUCCESSFUL',
      occurredAt: '2025-01-01T00:00:00.000Z',
    } as any;

    await expect(
      controller.handleCallback(body, {} as any, '1736182800123', 'aabbccddeeff'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(providerCallbacksService.handleCallback).not.toHaveBeenCalled();
  });
});
