import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentAttemptStatus,
  PaymentProvider,
  PaymentStatus,
} from '../generated/prisma/enums.js';
import { DatabaseService } from '../database/database.service.js';
import { NowPaymentsApiClient } from '../payment-providers/adapters/nowpayments/nowpayments-api.client.js';
import { isNowPaymentsIpnPayload } from '../payment-providers/adapters/nowpayments/nowpayments-webhook-payload.guard.js';
import { ProviderCallbacksService } from './provider-callbacks.service.js';

const RECONCILIATION_INTERVAL_MS = 60_000;
const STALE_PAYMENT_AGE_MS = 5 * 60_000;
const RECONCILIATION_BATCH_SIZE = 50;

@Injectable()
export class NowPaymentsReconciliationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NowPaymentsReconciliationService.name);
  private intervalHandle: NodeJS.Timeout | undefined;
  private isRunning = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly nowPaymentsApiClient: NowPaymentsApiClient,
    private readonly providerCallbacksService: ProviderCallbacksService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.configService.get<string>('nowpayments.apiKey')) {
      this.logger.log(
        'NOWPayments reconciliation disabled because no API key is configured.',
      );
      return;
    }

    void this.reconcilePendingPayments().catch((error: unknown) => {
      this.logger.error(
        `NOWPayments reconciliation run failed: ${this.describeError(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    });
    this.intervalHandle = setInterval(() => {
      void this.reconcilePendingPayments().catch((error: unknown) => {
        this.logger.error(
          `NOWPayments reconciliation run failed: ${this.describeError(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      });
    }, RECONCILIATION_INTERVAL_MS);
    this.intervalHandle.unref?.();
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }
  }

  async reconcilePendingPayments(): Promise<void> {
    if (this.isRunning || !this.configService.get<string>('nowpayments.apiKey')) {
      return;
    }

    this.isRunning = true;
    try {
      const staleBefore = new Date(Date.now() - STALE_PAYMENT_AGE_MS);
      const candidates = await this.database.cryptoPaymentDetail.findMany({
        where: {
          nowpaymentsPaymentId: { not: null },
          updatedAt: { lte: staleBefore },
          OR: [
            { lastReportedStatus: null },
            { lastReportedStatus: { not: 'refunded' } },
          ],
          attempt: {
            is: {
              status: {
                in: [
                  PaymentAttemptStatus.STARTED,
                  PaymentAttemptStatus.PROCESSING,
                  PaymentAttemptStatus.UNKNOWN,
                ],
              },
              transaction: {
                is: {
                  provider: PaymentProvider.NOWPAYMENTS,
                  status: {
                    in: [
                      PaymentStatus.PROCESSING,
                      PaymentStatus.PENDING_RECONCILIATION,
                    ],
                  },
                },
              },
            },
          },
        },
        orderBy: { updatedAt: 'asc' },
        take: RECONCILIATION_BATCH_SIZE,
        select: { id: true, nowpaymentsPaymentId: true },
      });

      for (const candidate of candidates) {
        const paymentId = candidate.nowpaymentsPaymentId;
        if (!paymentId) {
          continue;
        }
        try {
          const response = await this.nowPaymentsApiClient.getPaymentStatus(
            paymentId,
          );
          if (
            !isNowPaymentsIpnPayload(response) ||
            response.payment_id !== paymentId
          ) {
            throw new Error(
              'NOWPayments status response did not match the requested payment.',
            );
          }

          await this.providerCallbacksService.handleReconciledNowPaymentsStatus(
            response,
          );
        } catch (error) {
          this.logger.error(
            `Could not reconcile NOWPayments payment ${paymentId}: ${this.describeError(error)}`,
            error,
          );
        } finally {
          try {
            await this.database.cryptoPaymentDetail.update({
              where: { id: candidate.id },
              data: { updatedAt: new Date() },
            });
          } catch (error) {
            this.logger.error(
              `Could not update reconciliation time for NOWPayments payment ${paymentId}: ${this.describeError(error)}`,
              error,
            );
          }
        }
      }
    } finally {
      this.isRunning = false;
    }
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return typeof error === 'string' ? error : 'Unknown error';
  }
}
