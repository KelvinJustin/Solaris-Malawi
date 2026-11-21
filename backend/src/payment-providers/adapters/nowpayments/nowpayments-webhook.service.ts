import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service.js';
import {
  PaymentAttemptStatus,
  PaymentProvider,
  PaymentStatus,
} from '../../../generated/prisma/enums.js';
import { LedgerPostingService } from '../../../ledger/ledger-posting.service.js';
import { mapNowPaymentsStatus, NowPaymentsStatus } from './nowpayments-status.util.js';

interface NowPaymentsIpnPayload {
  payment_id: string;
  payment_status: NowPaymentsStatus;
  actually_paid?: number;
  pay_amount?: number;
  order_id?: string;
}

export function isNowPaymentsIpnPayload(value: unknown): value is NowPaymentsIpnPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.payment_id === 'string' &&
    typeof record.payment_status === 'string' &&
    [
      'waiting',
      'confirming',
      'confirmed',
      'sending',
      'partially_paid',
      'finished',
      'failed',
      'expired',
      'refunded',
    ].includes(record.payment_status) &&
    (record.actually_paid === undefined ||
      (typeof record.actually_paid === 'number' &&
        Number.isFinite(record.actually_paid)))
  );
}

@Injectable()
export class NowPaymentsWebhookService {
  private readonly logger = new Logger(NowPaymentsWebhookService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly ledgerPostingService: LedgerPostingService,
  ) {}

  async handleVerifiedCallback(payload: NowPaymentsIpnPayload): Promise<void> {
    const detail = await this.databaseService.cryptoPaymentDetail.findUnique({
      where: { nowpaymentsPaymentId: payload.payment_id },
      include: {
        attempt: {
          include: { transaction: true },
        },
      },
    });

    if (!detail) {
      this.logger.warn(
        `Received IPN for unknown NOWPayments payment_id=${payload.payment_id}; ignoring.`,
      );
      return;
    }

    await this.databaseService.cryptoPaymentIpnEvent.create({
      data: {
        cryptoPaymentDetailId: detail.id,
        reportedStatus: payload.payment_status,
        actuallyPaidAmount: payload.actually_paid ?? null,
        rawPayload: payload as unknown as object,
      },
    });

    const mapped = mapNowPaymentsStatus(payload.payment_status);
    const attempt = detail.attempt;
    const transaction = attempt.transaction;

    await this.databaseService.$transaction(async (tx) => {
      await tx.cryptoPaymentDetail.update({
        where: { id: detail.id },
        data: {
          lastReportedStatus: payload.payment_status,
          actuallyPaidAmount: payload.actually_paid ?? detail.actuallyPaidAmount,
        },
      });

      const attemptUpdate = await tx.paymentAttempt.updateMany({
        where: {
          id: attempt.id,
          status: {
            in: [
              PaymentAttemptStatus.STARTED,
              PaymentAttemptStatus.PROCESSING,
              PaymentAttemptStatus.UNKNOWN,
            ],
          },
        },
        data: {
          status: mapped.attemptStatus,
          providerReference: payload.payment_id,
          completedAt: mapped.isTerminal ? new Date() : null,
        },
      });

      if (attemptUpdate.count !== 1) {
        this.logger.log(
          `IPN for payment_id=${payload.payment_id} did not change attempt ${attempt.id} (already finalized).`,
        );
        return;
      }

      const sourceStatuses =
        mapped.transactionStatus === PaymentStatus.PROCESSING
          ? [PaymentStatus.PROCESSING]
          : [
              PaymentStatus.PROCESSING,
              PaymentStatus.PENDING_RECONCILIATION,
            ];
      const transactionUpdate = await tx.paymentTransaction.updateMany({
        where: {
          id: transaction.id,
          status: { in: sourceStatuses },
        },
        data: {
          status: mapped.transactionStatus,
          processedAt: mapped.isTerminal ? new Date() : null,
        },
      });

      if (transactionUpdate.count !== 1) {
        this.logger.warn(
          `IPN for payment_id=${payload.payment_id} mapped to ${mapped.transactionStatus} ` +
            `but transaction ${transaction.id} was no longer PROCESSING. ` +
            `Raw event recorded for manual review; no automatic transition applied.`,
        );
        throw new ConflictException(
          'Payment changed while processing the NOWPayments callback.',
        );
      }

      if (mapped.transactionStatus === PaymentStatus.SUCCEEDED) {
        if (
          transaction.provider !== PaymentProvider.NOWPAYMENTS ||
          transaction.merchantNetTambala === null
        ) {
          throw new InternalServerErrorException(
            'Successful NOWPayments transaction is missing its ledger snapshot',
          );
        }

        await this.ledgerPostingService.postSuccessfulPayment(tx, {
          paymentId: transaction.id,
          publicReference: transaction.publicReference,
          merchantId: transaction.merchantId,
          provider: transaction.provider,
          amountTambala: BigInt(transaction.amountTambala),
          feeTambala: transaction.feeTambala,
          merchantNetTambala: transaction.merchantNetTambala,
          currency: transaction.currency,
          source: 'CALLBACK',
        });
      }
    });
  }
}