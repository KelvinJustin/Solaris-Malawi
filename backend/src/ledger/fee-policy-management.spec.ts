import { describe, expect, it, vi } from 'vitest';
import { FeePolicyAuditAction, FeeType } from '../generated/prisma/enums.js';
import { createFeePolicyVersion } from './fee-policy-management.js';

function makeTx() {
  return {
    merchant: { findUnique: vi.fn().mockResolvedValue(null) },
    feePolicy: {
      findFirst: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'policy-v2', version: 2 }),
      update: vi.fn().mockResolvedValue({}),
    },
    feePolicyAuditEvent: { create: vi.fn().mockResolvedValue({}) },
  } as any;
}

const input = {
  merchantId: null,
  currency: 'MWK',
  type: FeeType.PERCENTAGE,
  percentageBps: 200,
  fixedAmountTambala: 0n,
  version: 2,
  source: 'approved pricing change',
  activate: true,
};

describe('controlled fee policy versioning', () => {
  it('creates a new immutable version and audits deactivation and activation', async () => {
    const tx = makeTx();
    tx.feePolicy.findFirst
      .mockResolvedValueOnce({ version: 1 })
      .mockResolvedValueOnce({ id: 'policy-v1' });

    await expect(createFeePolicyVersion(tx, input)).resolves.toEqual({
      id: 'policy-v2',
      version: 2,
      active: true,
    });

    expect(tx.feePolicy.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ version: 2, active: false, source: input.source }),
    });
    expect(tx.feePolicy.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'policy-v1' },
      data: { active: false },
    });
    expect(tx.feePolicy.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'policy-v2' },
      data: { active: true },
    });
    expect(tx.feePolicyAuditEvent.create).toHaveBeenCalledTimes(3);
    expect(tx.feePolicyAuditEvent.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        policyId: 'policy-v1',
        action: FeePolicyAuditAction.DEACTIVATED,
      }),
    });
    expect(tx.feePolicyAuditEvent.create).toHaveBeenNthCalledWith(3, {
      data: expect.objectContaining({
        policyId: 'policy-v2',
        action: FeePolicyAuditAction.ACTIVATED,
      }),
    });
  });

  it('rejects skipped or reused versions', async () => {
    const tx = makeTx();
    tx.feePolicy.findFirst.mockResolvedValueOnce({ version: 1 });

    await expect(createFeePolicyVersion(tx, { ...input, version: 3 }))
      .rejects.toThrow('Expected policy version 2, received 3');
    expect(tx.feePolicy.create).not.toHaveBeenCalled();
  });

  it('rolls back if activation conflicts at the database uniqueness boundary', async () => {
    const tx = makeTx();
    tx.feePolicy.findFirst
      .mockResolvedValueOnce({ version: 1 })
      .mockResolvedValueOnce(null);
    tx.feePolicy.update.mockRejectedValue(new Error('active policy uniqueness conflict'));

    await expect(createFeePolicyVersion(tx, input))
      .rejects.toThrow('active policy uniqueness conflict');
    expect(tx.feePolicyAuditEvent.create).toHaveBeenCalledTimes(1);
  });
});
