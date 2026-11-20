import { describe, expect, it, vi } from 'vitest';
import { FeeType } from '../generated/prisma/enums.js';
import { calculateFeeTambala, FeePolicyService } from './fee-policy.service.js';

describe('fee policy calculations', () => {
  it('calculates a zero fee', () => {
    expect(
      calculateFeeTambala({
        amountTambala: 10_000n,
        type: FeeType.ZERO,
        percentageBps: 0,
        fixedAmountTambala: 0n,
      }),
    ).toBe(0n);
  });

  it('calculates a percentage fee using half-up integer rounding', () => {
    expect(
      calculateFeeTambala({
        amountTambala: 10_000n,
        type: FeeType.PERCENTAGE,
        percentageBps: 250,
        fixedAmountTambala: 0n,
      }),
    ).toBe(250n);
    expect(
      calculateFeeTambala({
        amountTambala: 2n,
        type: FeeType.PERCENTAGE,
        percentageBps: 2_500,
        fixedAmountTambala: 0n,
      }),
    ).toBe(1n);
  });

  it('calculates fixed and hybrid fees', () => {
    expect(
      calculateFeeTambala({
        amountTambala: 10_000n,
        type: FeeType.FIXED,
        percentageBps: 0,
        fixedAmountTambala: 75n,
      }),
    ).toBe(75n);
    expect(
      calculateFeeTambala({
        amountTambala: 10_000n,
        type: FeeType.HYBRID,
        percentageBps: 200,
        fixedAmountTambala: 50n,
      }),
    ).toBe(250n);
  });

  it('rejects a fee that exceeds the payment amount', () => {
    expect(() =>
      calculateFeeTambala({
        amountTambala: 100n,
        type: FeeType.FIXED,
        percentageBps: 0,
        fixedAmountTambala: 101n,
      }),
    ).toThrow('Calculated fee must be less than payment amount');
  });

  it('accepts the maximum percentage below 100% and rejects rates outside policy bounds', () => {
    expect(
      calculateFeeTambala({
        amountTambala: 10_000n,
        type: FeeType.PERCENTAGE,
        percentageBps: 9_999,
        fixedAmountTambala: 0n,
      }),
    ).toBe(9_999n);

    expect(() =>
      calculateFeeTambala({
        amountTambala: 10_000n,
        type: FeeType.PERCENTAGE,
        percentageBps: 10_000,
        fixedAmountTambala: 0n,
      }),
    ).toThrow('Invalid payment fee policy configuration');
  });

  it('selects a merchant override before the platform default and snapshots it', async () => {
    const merchantPolicy = {
      id: 'merchant-policy-v2',
      merchantId: 'merchant-1',
      type: FeeType.PERCENTAGE,
      percentageBps: 200,
      fixedAmountTambala: 0n,
      currency: 'MWK',
      version: 2,
    };
    const tx = {
      feePolicy: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(merchantPolicy)
          .mockResolvedValueOnce({ id: 'platform-policy', type: FeeType.ZERO }),
      },
    } as any;

    const snapshot = await new FeePolicyService().snapshotForPayment(tx, {
      merchantId: 'merchant-1',
      currency: 'MWK',
      amountTambala: 10_000n,
    });

    expect(tx.feePolicy.findFirst).toHaveBeenCalledTimes(1);
    expect(snapshot).toEqual({
      feeTambala: 200n,
      merchantNetTambala: 9_800n,
      feeType: FeeType.PERCENTAGE,
      feePercentageBps: 200,
      feeFixedTambala: 0n,
      feePolicyId: 'merchant-policy-v2',
      feePolicyVersion: 2,
      currency: 'MWK',
    });

    merchantPolicy.percentageBps = 500;
    expect(snapshot.feeTambala).toBe(200n);
  });

  it('falls back to the active platform policy when no merchant override exists', async () => {
    const tx = {
      feePolicy: {
        findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
          id: 'platform-zero-v1',
          type: FeeType.ZERO,
          percentageBps: 0,
          fixedAmountTambala: 0n,
          currency: 'MWK',
          version: 1,
        }),
      },
    } as any;

    const snapshot = await new FeePolicyService().snapshotForPayment(tx, {
      merchantId: 'merchant-1',
      currency: 'MWK',
      amountTambala: 500n,
    });

    expect(tx.feePolicy.findFirst).toHaveBeenCalledTimes(2);
    expect(snapshot.feePolicyId).toBe('platform-zero-v1');
    expect(snapshot.merchantNetTambala).toBe(500n);
  });
});
