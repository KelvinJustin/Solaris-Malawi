import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';

import { ProviderCallbacksController } from './provider-callbacks.controller.js';
import { ProviderCallbacksService } from './provider-callbacks.service.js';

describe('ProviderCallbacksController', () => {
  let controller: ProviderCallbacksController;

  const providerCallbacksService = {
    handleCallback: vi.fn(),
    handleNowPaymentsCallback: vi.fn(),
  };

  const previousIpnSecret = process.env.NOWPAYMENTS_IPN_SECRET;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.NOWPAYMENTS_IPN_SECRET = 'test-ipn-secret';

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProviderCallbacksController],
      providers: [
        {
          provide: ProviderCallbacksService,
          useValue: providerCallbacksService,
        },
      ],
    }).compile();

    controller = module.get<ProviderCallbacksController>(
      ProviderCallbacksController,
    );
  });

  afterEach(() => {
    if (previousIpnSecret === undefined) {
      delete process.env.NOWPAYMENTS_IPN_SECRET;
    } else {
      process.env.NOWPAYMENTS_IPN_SECRET = previousIpnSecret;
    }
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
      controller.handleCallback(body, request, '1736182800123', 'aabbccddeeff'),
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
      controller.handleCallback(
        body,
        {} as any,
        '1736182800123',
        'aabbccddeeff',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(providerCallbacksService.handleCallback).not.toHaveBeenCalled();
  });

  it('verifies NOWPayments IPNs and forwards the validated payload', async () => {
    const body = {
      actually_paid: 0.00012,
      payment_id: 'np-payment-1',
      payment_status: 'finished',
    };
    const signature = createHmac('sha512', 'test-ipn-secret')
      .update(JSON.stringify(body))
      .digest('hex');
    const result = { received: true, duplicate: false };
    providerCallbacksService.handleNowPaymentsCallback.mockResolvedValue(
      result,
    );

    const request = { rawBody: Buffer.from(JSON.stringify(body)) } as any;
    await expect(
      controller.handleNowPaymentsCallback(body, request, signature),
    ).resolves.toEqual(result);
    expect(
      providerCallbacksService.handleNowPaymentsCallback,
    ).toHaveBeenCalledWith({
      ...body,
      actually_paid: '0.00012',
    });
  });

  it('rejects a NOWPayments IPN with an invalid signature', async () => {
    await expect(
      controller.handleNowPaymentsCallback(
        { payment_id: 'np-payment-1', payment_status: 'finished' },
        {
          rawBody: Buffer.from(
            '{"payment_id":"np-payment-1","payment_status":"finished"}',
          ),
        } as any,
        'invalid',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(
      providerCallbacksService.handleNowPaymentsCallback,
    ).not.toHaveBeenCalled();
  });
});
