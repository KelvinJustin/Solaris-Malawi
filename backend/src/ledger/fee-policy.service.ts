import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { FeeType } from '../generated/prisma/enums.js';

export interface FeeSnapshot {
  feeTambala: bigint;
  merchantNetTambala: bigint;
  feeType: FeeType;
  feePercentageBps: number;
  feeFixedTambala: bigint;
  feePolicyId: string;
  feePolicyVersion: number;
  currency: string;
}

export function calculateFeeTambala(input: {
  amountTambala: bigint;
  type: FeeType;
  percentageBps: number;
  fixedAmountTambala: bigint;
}): bigint {
  const { amountTambala, type, percentageBps, fixedAmountTambala } = input;

  if (
    amountTambala <= 0n ||
    !Number.isInteger(percentageBps) ||
    percentageBps < 0 ||
    percentageBps > 9_999 ||
    fixedAmountTambala < 0n
  ) {
    throw new InternalServerErrorException('Invalid payment fee policy configuration');
  }

  if (type === FeeType.ZERO && (percentageBps !== 0 || fixedAmountTambala !== 0n)) {
    throw new InternalServerErrorException('ZERO fee policy must have zero rate and amount');
  }
  if (type === FeeType.PERCENTAGE && fixedAmountTambala !== 0n) {
    throw new InternalServerErrorException('PERCENTAGE fee policy cannot include a fixed amount');
  }
  if (type === FeeType.FIXED && percentageBps !== 0) {
    throw new InternalServerErrorException('FIXED fee policy cannot include a percentage');
  }

  const percentageFee =
    type === FeeType.PERCENTAGE || type === FeeType.HYBRID
      ? (amountTambala * BigInt(percentageBps) + 5_000n) / 10_000n
      : 0n;
  const fixedFee = type === FeeType.FIXED || type === FeeType.HYBRID
    ? fixedAmountTambala
    : 0n;
  const fee = percentageFee + fixedFee;

  if (fee >= amountTambala) {
    throw new InternalServerErrorException('Calculated fee must be less than payment amount');
  }

  return fee;
}

@Injectable()
export class FeePolicyService {
  async snapshotForPayment(
    tx: Prisma.TransactionClient,
    input: {
      merchantId: string;
      currency: string;
      amountTambala: bigint;
    },
  ): Promise<FeeSnapshot> {
    const where = { active: true, currency: input.currency };
    const merchantPolicy = await tx.feePolicy.findFirst({
      where: { ...where, merchantId: input.merchantId },
    });
    const policy = merchantPolicy ?? await tx.feePolicy.findFirst({
      where: { ...where, merchantId: null },
    });

    if (!policy) {
      throw new InternalServerErrorException(
        `No active fee policy is configured for ${input.currency}`,
      );
    }

    const feeTambala = calculateFeeTambala({
      amountTambala: input.amountTambala,
      type: policy.type,
      percentageBps: policy.percentageBps,
      fixedAmountTambala: policy.fixedAmountTambala,
    });

    return {
      feeTambala,
      merchantNetTambala: input.amountTambala - feeTambala,
      feeType: policy.type,
      feePercentageBps: policy.percentageBps,
      feeFixedTambala: policy.fixedAmountTambala,
      feePolicyId: policy.id,
      feePolicyVersion: policy.version,
      currency: policy.currency,
    };
  }
}
