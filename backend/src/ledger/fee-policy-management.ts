import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { FeePolicyAuditAction, FeeType } from '../generated/prisma/enums.js';

export interface CreateFeePolicyVersionInput {
  merchantId: string | null;
  currency: string;
  type: FeeType;
  percentageBps: number;
  fixedAmountTambala: bigint;
  version: number;
  source: string;
  activate: boolean;
}

export async function createFeePolicyVersion(
  tx: Prisma.TransactionClient,
  input: CreateFeePolicyVersionInput,
) {
  if (input.merchantId) {
    const merchant = await tx.merchant.findUnique({
      where: { id: input.merchantId },
      select: { id: true },
    });
    if (!merchant) throw new NotFoundException('Fee policy merchant does not exist');
  }

  const latest = await tx.feePolicy.findFirst({
    where: { merchantId: input.merchantId, currency: input.currency },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const expectedVersion = (latest?.version ?? 0) + 1;
  if (input.version !== expectedVersion) {
    throw new ConflictException(`Expected policy version ${expectedVersion}, received ${input.version}`);
  }

  const activePolicy = await tx.feePolicy.findFirst({
    where: { merchantId: input.merchantId, currency: input.currency, active: true },
    select: { id: true },
  });
  const policy = await tx.feePolicy.create({
    data: {
      merchantId: input.merchantId,
      currency: input.currency,
      type: input.type,
      percentageBps: input.percentageBps,
      fixedAmountTambala: input.fixedAmountTambala,
      version: input.version,
      active: false,
      source: input.source,
    },
  });
  await tx.feePolicyAuditEvent.create({
    data: { policyId: policy.id, action: FeePolicyAuditAction.CREATED, source: input.source },
  });

  if (input.activate) {
    if (activePolicy) {
      await tx.feePolicy.update({
        where: { id: activePolicy.id },
        data: { active: false },
      });
      await tx.feePolicyAuditEvent.create({
        data: {
          policyId: activePolicy.id,
          action: FeePolicyAuditAction.DEACTIVATED,
          source: input.source,
        },
      });
    }
    await tx.feePolicy.update({
      where: { id: policy.id },
      data: { active: true },
    });
    await tx.feePolicyAuditEvent.create({
      data: { policyId: policy.id, action: FeePolicyAuditAction.ACTIVATED, source: input.source },
    });
  }

  return { id: policy.id, version: policy.version, active: input.activate };
}
