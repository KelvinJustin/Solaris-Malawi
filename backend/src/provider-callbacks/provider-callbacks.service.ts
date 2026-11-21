import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentAttemptStatus,
  PaymentProvider,
  PaymentStatus,
  PaymentType,
} from '../generated/prisma/enums.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import { LedgerPostingService } from '../ledger/ledger-posting.service.js';
import {
  ProviderCallbackDto,
  ProviderCallbackStatus,
} from './dto/provider-callback.dto.js';

import { mapNowPaymentsStatus } from '../payment-providers/adapters/nowpayments/nowpayments-status.util.js';
import type { NowPaymentsIpnPayload } from '../payment-providers/adapters/nowpayments/nowpayments-webhook-payload.guard.js';
import { CryptoLedgerPostingService } from '../ledger/crypto-ledger-posting.service.js';

interface CallbackInput {
  body: ProviderCallbackDto;
  rawBody: Buffer;
  timestamp?: string;
  signature?: string;
}

@Injectable()
export class ProviderCallbacksService {
  private readonly maxTimestampAgeMs = 5 * 60 * 1000;

  constructor(
    private readonly database: DatabaseService,
    private readonly ledgerPostingService: LedgerPostingService,
    private readonly cryptoLedgerPostingService: CryptoLedgerPostingService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Handles the signed provider webhook for a payment update.
   *
   * This is the canonical place where callback payloads are validated against
   * stored records. We reject replayed callbacks, stale signatures, and any
   * payload that contradicts the payment history.
   */
  async handleCallback(input: CallbackInput) {
    this.verifySignature(input);

    const { body } = input;

    if (body.event !== 'payment.updated') {
      throw new BadRequestException('Unsupported callback event');
    }
    if (!Object.values(ProviderCallbackStatus).includes(body.status)) {
      throw new BadRequestException('Unsupported callback payment status');
    }

    // The simulator sends amount in MWK; the database stores tambala.
    // Reject amounts that cannot be represented exactly to two decimals.
    const amountInTambala = body.amount * 100;
    if (
      !Number.isFinite(amountInTambala) ||
      !Number.isSafeInteger(Math.round(amountInTambala)) ||
      Math.abs(amountInTambala - Math.round(amountInTambala)) > 1e-7
    ) {
      throw new BadRequestException('Invalid callback amount');
    }

    const expectedStatus =
      body.status === ProviderCallbackStatus.SUCCESSFUL
        ? PaymentStatus.SUCCEEDED
        : PaymentStatus.FAILED;

    return this.database.$transaction(async (tx) => {
      // attemptReference is the PaymentAttempt UUID sent to the simulator.
      const attempt = await tx.paymentAttempt.findUnique({
        where: { id: body.attemptReference },
        include: {
          transaction: { include: { mwkDetail: true } },
        },
      });

      if (!attempt) {
        throw new BadRequestException('Unknown payment attempt');
      }

      const transaction = attempt.transaction;

      // Bind every callback identifier to the persisted payment records.
      if (
        transaction.publicReference !== body.transactionReference ||
        transaction.provider !== body.provider ||
        attempt.provider !== body.provider
      ) {
        throw new ConflictException(
          'Callback does not match the stored payment',
        );
      }

      if (
        transaction.paymentType !== PaymentType.MWK ||
        !transaction.mwkDetail ||
        transaction.mwkDetail.amountTambala !== Math.round(amountInTambala) ||
        transaction.mwkDetail.currency !== body.currency ||
        body.currency !== 'MWK'
      ) {
        throw new ConflictException(
          'Callback amount or currency does not match the payment',
        );
      }

      if (
        (transaction.providerReference !== null &&
          transaction.providerReference !== body.providerReference) ||
        (attempt.providerReference !== null &&
          attempt.providerReference !== body.providerReference)
      ) {
        throw new ConflictException('Provider reference mismatch');
      }

      // A repeated callback with the same final outcome is harmless.
      if (
        transaction.status === expectedStatus &&
        attempt.status ===
          (expectedStatus === PaymentStatus.SUCCEEDED
            ? PaymentAttemptStatus.SUCCEEDED
            : PaymentAttemptStatus.FAILED)
      ) {
        return { received: true, duplicate: true };
      }

      // Never let a contradictory callback reverse a terminal payment.
      if (
        transaction.status === PaymentStatus.SUCCEEDED ||
        transaction.status === PaymentStatus.FAILED
      ) {
        throw new ConflictException(
          'Payment already has a different final status',
        );
      }

      // Only initiated or reconciliation-pending payments can be completed.
      if (
        transaction.status !== PaymentStatus.PROCESSING &&
        transaction.status !== PaymentStatus.PENDING_RECONCILIATION
      ) {
        throw new ConflictException(
          'Payment is not awaiting a provider result',
        );
      }

      if (
        attempt.status === PaymentAttemptStatus.SUCCEEDED ||
        attempt.status === PaymentAttemptStatus.FAILED
      ) {
        throw new ConflictException(
          'Payment attempt already has a different final status',
        );
      }

      const now = new Date();
      const finalAttemptStatus =
        expectedStatus === PaymentStatus.SUCCEEDED
          ? PaymentAttemptStatus.SUCCEEDED
          : PaymentAttemptStatus.FAILED;

      // Claim the attempt only if it has not already reached a final state.
      // This prevents concurrent callbacks from finalizing it twice.
      const updatedAttempt = await tx.paymentAttempt.updateMany({
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
          status: finalAttemptStatus,
          providerReference: body.providerReference,
          failureCode:
            expectedStatus === PaymentStatus.FAILED ? body.failureCode : null,
          failureMessage:
            expectedStatus === PaymentStatus.FAILED
              ? body.failureMessage
              : null,
          completedAt: now,
        },
      });

      // Another callback may have finalized the attempt after our read.
      if (updatedAttempt.count !== 1) {
        const currentAttempt = await tx.paymentAttempt.findUnique({
          where: { id: attempt.id },
          include: { transaction: true },
        });

        if (
          currentAttempt?.status === finalAttemptStatus &&
          currentAttempt.transaction.status === expectedStatus &&
          currentAttempt.providerReference === body.providerReference &&
          currentAttempt.transaction.providerReference ===
            body.providerReference
        ) {
          return { received: true, duplicate: true };
        }

        throw new ConflictException('Payment attempt has already changed.');
      }

      // Only finalize the transaction if it is still awaiting a result.
      const updatedTransaction = await tx.paymentTransaction.updateMany({
        where: {
          id: transaction.id,
          status: {
            in: [
              PaymentStatus.PROCESSING,
              PaymentStatus.PENDING_RECONCILIATION,
            ],
          },
          OR: [
            { providerReference: null },
            { providerReference: body.providerReference },
          ],
        },
        data: {
          status: expectedStatus,
          providerReference: body.providerReference,
          failureCode:
            expectedStatus === PaymentStatus.FAILED ? body.failureCode : null,
          failureMessage:
            expectedStatus === PaymentStatus.FAILED
              ? body.failureMessage
              : null,
          processedAt: now,
        },
      });

      if (updatedTransaction.count !== 1) {
        // Throwing rolls back the attempt update as well.
        throw new ConflictException(
          'Payment changed while processing the callback.',
        );
      }

      if (expectedStatus === PaymentStatus.SUCCEEDED) {
        const detail = transaction.mwkDetail;
        if (!transaction.provider || !detail) {
          throw new InternalServerErrorException(
            'Successful payment is missing its immutable ledger snapshot',
          );
        }

        await this.ledgerPostingService.postSuccessfulPayment(tx, {
          paymentId: transaction.id,
          publicReference: transaction.publicReference,
          merchantId: transaction.merchantId,
          provider: transaction.provider,
          amountTambala: BigInt(detail.amountTambala),
          feeTambala: detail.feeTambala,
          merchantNetTambala: detail.merchantNetTambala,
          currency: detail.currency,
          source: 'CALLBACK',
        });
      }

      return { received: true, duplicate: false };
    });
  }

  /**
   * Verifies that the callback was signed with the provider secret and that the
   * timestamp is still fresh enough to trust.
   *
   * The signature is calculated from the raw request body; we intentionally do
   * not validate against a parsed JSON object because the HMAC is based on the
   * exact bytes sent by the provider.
   */
  private verifySignature(input: CallbackInput): void {
    const { timestamp, signature, rawBody } = input;

    if (
      !timestamp ||
      !/^\d{13}$/.test(timestamp) ||
      !signature ||
      !/^[a-f0-9]{64}$/i.test(signature)
    ) {
      throw new UnauthorizedException('Missing or invalid callback signature');
    }

    const timestampMs = Number(timestamp);
    const ageMs = Math.abs(Date.now() - timestampMs);

    if (!Number.isSafeInteger(timestampMs) || ageMs > this.maxTimestampAgeMs) {
      throw new UnauthorizedException('Callback timestamp is expired');
    }

    const secret = process.env.SIGNING_SECRET;

    // Do not allow a weak or missing signing secret in production.
    if (
      process.env.NODE_ENV === 'production' &&
      (!secret || secret.length < 32)
    ) {
      throw new InternalServerErrorException(
        'Provider callback signing secret is not configured securely',
      );
    }

    // Match the simulator's development fallback only outside production.
    const signingSecret =
      secret ||
      (process.env.NODE_ENV === 'production'
        ? undefined
        : 'local-development-secret');

    if (!signingSecret) {
      throw new InternalServerErrorException(
        'Provider callback signing secret is missing',
      );
    }

    const expected = createHmac('sha256', signingSecret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest();

    const received = Buffer.from(signature, 'hex');

    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new UnauthorizedException('Invalid callback signature');
    }
  }

  /**
   * Handles a signature-verified NOWPayments IPN callback.
   *
   * Deliberately NOT sharing handleCallback()'s binary SUCCESSFUL/FAILED
   * model: NOWPayments can report an intermediate outcome (partially_paid,
   * refunded) that neither succeeds nor fails the payment outright — those
   * land in PENDING_RECONCILIATION, same as applyInitiationResult's UNKNOWN
   * outcome does today, just reached by a different path.
   *
   * The binding enforced here is the stored nowpaymentsPaymentId and the
   * transaction's crypto type/provider. The amount credited is NOWPayments'
   * actually_paid value, persisted in the transaction's asset/network.
   */
  async handleNowPaymentsCallback(payload: NowPaymentsIpnPayload) {
    const detail = await this.database.cryptoPaymentDetail.findUnique({
      where: { nowpaymentsPaymentId: payload.payment_id },
      select: { id: true },
    });

    if (!detail) {
      throw new BadRequestException('Unknown NOWPayments payment_id');
    }

    await this.database.cryptoPaymentIpnEvent.create({
      data: {
        cryptoPaymentDetailId: detail.id,
        reportedStatus: payload.payment_status,
        actuallyPaidAmount: payload.actually_paid ?? null,
        rawPayload: payload as unknown as object,
      },
    });

    return this.applyNowPaymentsStatus(payload);
  }

  async handleReconciledNowPaymentsStatus(payload: NowPaymentsIpnPayload) {
    return this.applyNowPaymentsStatus(payload);
  }

  private async applyNowPaymentsStatus(payload: NowPaymentsIpnPayload) {
    const detail = await this.database.cryptoPaymentDetail.findUnique({
      where: { nowpaymentsPaymentId: payload.payment_id },
      include: { attempt: true, transaction: true },
    });

    if (!detail) {
      throw new BadRequestException('Unknown NOWPayments payment_id');
    }

    const mapped = mapNowPaymentsStatus(payload.payment_status);

    return this.database.$transaction(async (tx) => {
      const currentDetail = await tx.cryptoPaymentDetail.findUnique({
        where: { id: detail.id },
        include: { attempt: true, transaction: true },
      });

      if (!currentDetail) {
        throw new BadRequestException('Unknown NOWPayments payment_id');
      }

      const attempt = currentDetail.attempt;
      if (!attempt) {
        throw new ConflictException(
          'NOWPayments payment detail is not linked to a payment attempt.',
        );
      }
      const transaction = currentDetail.transaction;

      if (transaction.provider !== PaymentProvider.NOWPAYMENTS) {
        throw new ConflictException(
          'Callback does not match the stored payment provider',
        );
      }
      if (transaction.paymentType !== PaymentType.CRYPTO) {
        throw new ConflictException(
          'NOWPayments callback does not match a crypto transaction.',
        );
      }

      const updateDetail = () =>
        tx.cryptoPaymentDetail.update({
          where: { id: currentDetail.id },
          data: {
            lastReportedStatus: payload.payment_status,
            actuallyPaidAmount:
              payload.actually_paid ?? currentDetail.actuallyPaidAmount,
          },
        });

      if (
        transaction.status === mapped.transactionStatus &&
        attempt.status === mapped.attemptStatus
      ) {
        if (
          transaction.status === PaymentStatus.SUCCEEDED &&
          payload.actually_paid !== undefined &&
          (!currentDetail.actuallyPaidAmount ||
            !currentDetail.actuallyPaidAmount.equals(payload.actually_paid))
        ) {
          throw new ConflictException(
            'Duplicate finished payment reported a different paid amount',
          );
        }
        await updateDetail();
        return { received: true, duplicate: true };
      }

      if (
        transaction.status === PaymentStatus.SUCCEEDED ||
        transaction.status === PaymentStatus.FAILED
      ) {
        throw new ConflictException(
          'Payment already has a different final status',
        );
      }

      const now = new Date();
      const updatedAttempt = await tx.paymentAttempt.updateMany({
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
          completedAt: mapped.isTerminal ? now : null,
        },
      });

      if (updatedAttempt.count !== 1) {
        const currentAttempt = await tx.paymentAttempt.findUnique({
          where: { id: attempt.id },
          include: { transaction: true },
        });
        if (
          currentAttempt?.status === mapped.attemptStatus &&
          currentAttempt.transaction.status === mapped.transactionStatus &&
          currentAttempt.providerReference === payload.payment_id
        ) {
          await updateDetail();
          return { received: true, duplicate: true };
        }
        throw new ConflictException('Payment attempt has already changed.');
      }

      const updatedTransaction = await tx.paymentTransaction.updateMany({
        where: {
          id: transaction.id,
          status: {
            in: [
              PaymentStatus.PROCESSING,
              PaymentStatus.PENDING_RECONCILIATION,
            ],
          },
        },
        data: {
          status: mapped.transactionStatus,
          processedAt: mapped.isTerminal ? now : null,
        },
      });

      if (updatedTransaction.count !== 1) {
        throw new ConflictException(
          'Payment changed while processing the callback.',
        );
      }

      await updateDetail();

      if (mapped.transactionStatus === PaymentStatus.SUCCEEDED) {
        const actuallyPaidAmount =
          payload.actually_paid ?? currentDetail.actuallyPaidAmount;
        if (actuallyPaidAmount === null || actuallyPaidAmount === undefined) {
          throw new InternalServerErrorException(
            'Crypto payment reported finished but has no actually_paid amount on record.',
          );
        }

        const posting =
          await this.cryptoLedgerPostingService.postSuccessfulCryptoPayment(
            tx,
            {
              paymentId: transaction.id,
              publicReference: transaction.publicReference,
              merchantId: transaction.merchantId,
              provider: PaymentProvider.NOWPAYMENTS,
              asset: currentDetail.asset,
              network: currentDetail.network,
              actuallyPaidAmount,
              feeBps: this.configService.getOrThrow<number>(
                'nowpayments.cryptoFeeBps',
              ),
            },
          );
        await tx.cryptoPaymentDetail.update({
          where: { id: currentDetail.id },
          data: {
            actuallyPaidAmount,
            feeAmount: posting.feeAmount,
            merchantNetAmount: posting.merchantNetAmount,
          },
        });
      }

      return { received: true, duplicate: false };
    });
  }
}
