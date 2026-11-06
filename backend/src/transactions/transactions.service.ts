
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';


import {
  PaymentAttemptStatus,
  PaymentProvider,
  PaymentStatus,
  CheckoutSessionStatus,
  AccountStatus,
} from '../generated/prisma/enums.js';

import { PaymentProviderRegistry } from '../payment-providers/registry/payment-provider.registry.js';
import { InitiateCheckoutPaymentDto } from './dto/initiate-checkout-payment.dto.js';
import type { ProviderInitiationResult } from '../payment-providers/contracts/payment-provider.interface.js';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { CheckoutTokenService } from './checkout-token.service.js';

// TODO: Add production logging for idempotency race conditions.

const CHECKOUT_SESSION_MINUTES = 30;

@Injectable()
export class TransactionsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly checkoutTokenService: CheckoutTokenService,
    private readonly configService: ConfigService,
    private readonly paymentProviderRegistry: PaymentProviderRegistry,
  ) { }

  async create(
    merchantId: string,
    idempotencyKey: string | undefined,
    dto: CreateTransactionDto,
  ) {
    // Require an idempotency key before doing any work.
    const key = idempotencyKey?.trim();

    if (!key || key.length > 255) {
      throw new BadRequestException(
        'A valid Idempotency-Key header is required.',
      );
    }

    // Only approved merchants may create payment transactions.
    const profile = await this.databaseService.merchantProfile.findUnique({
      where: { merchantId },
      select: { accountStatus: true },
    });

    if (profile?.accountStatus !== AccountStatus.APPROVED) {
      throw new ForbiddenException(
        'Your merchant account must be approved before creating payments.',
      );
    }

    // Normalize optional fields so equivalent retries compare consistently.
    const requestData = {
      amountTambala: dto.amountTambala,
      currency: 'MWK',
      customerPhone: dto.customerPhone?.trim() || null,
      description: dto.description?.trim() || null,
      merchantReference: dto.merchantReference?.trim() || null,
    };

    // Reuse the transaction if this key was already used.
    const existing = await this.findByIdempotencyKey(merchantId, key);

    if (existing) {
      this.assertSameRequest(existing, requestData);
      return this.getCheckoutResponse(existing);
    }

    // Prepare the first checkout session.
    const token = this.checkoutTokenService.createToken();
    const expiresAt = this.getSessionExpiry();
    const checkoutUrl = this.buildCheckoutUrl(token.token);

    try {
      // The transaction and session either both persist or neither does.
      const payment = await this.databaseService.$transaction(async (tx) => {
        const transaction = await tx.paymentTransaction.create({
          data: {
            publicReference: `sp_${randomUUID().replaceAll('-', '')}`,
            merchantId,
            ...requestData,
            idempotencyKey: key,
            status: PaymentStatus.CREATED,
          },
        });

        await tx.checkoutSession.create({
          data: {
            transactionId: transaction.id,
            tokenHash: token.tokenHash,
            tokenEncrypted: token.tokenEncrypted,
            status: CheckoutSessionStatus.ACTIVE,
            expiresAt,
          },
        });

        return transaction;
      });

      return {
        publicReference: payment.publicReference,
        status: payment.status,
        amountTambala: payment.amountTambala,
        currency: payment.currency,
        checkout_url: checkoutUrl,
        expires_at: expiresAt,
      };
    } catch (error) {
      // A concurrent request may have created the transaction first.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrent = await this.findByIdempotencyKey(
          merchantId,
          key,
        );

        if (concurrent) {
          this.assertSameRequest(concurrent, requestData);
          return this.getCheckoutResponse(concurrent);
        }
      }

      throw error;
    }
  }

  /**
   * Find a transaction by its merchant-scoped idempotency key.
   */
  private findByIdempotencyKey(merchantId: string, key: string) {
    return this.databaseService.paymentTransaction.findUnique({
      where: {
        merchantId_idempotencyKey: {
          merchantId,
          idempotencyKey: key,
        },
      },
      include: {
        checkoutSessions: {
          where: {
            status: CheckoutSessionStatus.ACTIVE,
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  /**
   * Reject reuse of an idempotency key with different payment details.
   */
  /**
 * Reject reuse of an idempotency key with different payment details.
 */
  private assertSameRequest(
    existing: {
      amountTambala: number;
      currency: string;
      customerPhone: string | null;
      description: string | null;
      merchantReference: string | null;
    },
    requestData: {
      amountTambala: number;
      currency: string;
      customerPhone: string | null;
      description: string | null;
      merchantReference: string | null;
    },
  ): void {
    const sameRequest =
      existing.amountTambala === requestData.amountTambala &&
      existing.currency === requestData.currency &&
      existing.customerPhone === requestData.customerPhone &&
      existing.description === requestData.description &&
      existing.merchantReference === requestData.merchantReference;

    if (!sameRequest) {
      throw new ConflictException(
        'This Idempotency-Key has already been used with different payment details.',
      );
    }
  }

  /**
 * Return the existing checkout link when its session is still valid.
 * If no valid session exists, do not silently create a new payment attempt.
 */
  private async getCheckoutResponse(transaction: {
    id: string;
    publicReference: string;
    status: PaymentStatus;
    amountTambala: number;
    currency: string;
    checkoutSessions: {
      tokenEncrypted: string;
      expiresAt: Date;
    }[];
  }) {
    const now = new Date();
    const session = transaction.checkoutSessions[0];

    if (session && session.expiresAt > now) {
      const token = this.checkoutTokenService.decryptToken(
        session.tokenEncrypted,
      );

      return {
        publicReference: transaction.publicReference,
        status: transaction.status,
        amountTambala: transaction.amountTambala,
        currency: transaction.currency,
        checkout_url: this.buildCheckoutUrl(token),
        expires_at: session.expiresAt,
      };
    }

    // Do not reopen a payment that is already processing, succeeded,
    // failed, or awaiting reconciliation. Recovery needs a separate policy.
    return {
      publicReference: transaction.publicReference,
      status: transaction.status,
      amountTambala: transaction.amountTambala,
      currency: transaction.currency,
      checkout_url: null,
      expires_at: null,
    };
  }

  private getSessionExpiry(): Date {
    return new Date(Date.now() + CHECKOUT_SESSION_MINUTES * 60 * 1000);
  }

  private buildCheckoutUrl(token: string): string {
    const baseUrl = this.configService
      .get<string>('CHECKOUT_BASE_URL')
      ?.trim()
      .replace(/\/+$/, '');

    if (!baseUrl) {
      throw new InternalServerErrorException(
        'CHECKOUT_BASE_URL is not configured.',
      );
    }

    try {
      const parsedUrl = new URL(baseUrl);

      if (
        parsedUrl.protocol !== 'https:' &&
        parsedUrl.hostname !== 'localhost'
      ) {
        throw new Error('HTTPS is required.');
      }

      if (parsedUrl.search || parsedUrl.hash) {
        throw new Error('The checkout base URL must not contain a query string or hash.');
      }
    } catch {
      throw new InternalServerErrorException(
        'CHECKOUT_BASE_URL must be a valid HTTPS base URL.',
      );
    }

    return `${baseUrl}/checkout/${token}`;
  }

  /**
   * Retrieve a transaction belonging to the authenticated merchant.
   * The public reference is used instead of the internal database ID.
   */
  async findOne(merchantId: string, reference: string) {
    const transaction =
      await this.databaseService.paymentTransaction.findFirst({
        where: {
          publicReference: reference,
          merchantId,
        },
      });

    if (!transaction) {
      throw new NotFoundException('Transaction not found.');
    }

    return transaction;
  }


  /**
   * Validate a public checkout token and return safe checkout details.
   *
   * Only the SHA-256 hash is used to find the session.
   * The raw token is never stored or logged by this method.
   * This method does not initiate a mobile-money payment.
   */
  async getCheckout(token: string) {
    const tokenHash = this.checkoutTokenService.hashToken(token);

    const session = await this.databaseService.checkoutSession.findUnique({
      where: { tokenHash },
      include: {
        transaction: {
          select: {
            publicReference: true,
            amountTambala: true,
            currency: true,
            description: true,
            status: true,
          },
        },
      },
    });

    // Use the same response for unknown and unavailable links.
    if (!session || session.status !== CheckoutSessionStatus.ACTIVE) {
      throw new NotFoundException(
        'Checkout link is invalid or unavailable.',
      );
    }

    // Expired links must not be used to start payments.
    if (session.expiresAt <= new Date()) {
      await this.databaseService.checkoutSession.updateMany({
        where: {
          id: session.id,
          status: CheckoutSessionStatus.ACTIVE,
        },
        data: {
          status: CheckoutSessionStatus.EXPIRED,
        },
      });

      throw new NotFoundException(
        'Checkout link is invalid or unavailable.',
      );
    }

    const transaction = session.transaction;

    return {
      reference: transaction.publicReference,
      amountTambala: transaction.amountTambala,
      currency: transaction.currency,
      description: transaction.description,
      status: transaction.status,

      // Only a newly created transaction can proceed to payment selection.
      canPay: transaction.status === PaymentStatus.CREATED,
    };
  }

  /**
 * Start one provider attempt for an active hosted checkout session.
 *
 * The checkout session and payment transaction are claimed atomically
 * before making the external HTTP request. Ambiguous provider outcomes
 * are sent to reconciliation rather than automatically retried.
 */
  async initiateCheckoutPayment(
    token: string,
    dto: InitiateCheckoutPaymentDto,
  ) {
    const tokenHash = this.checkoutTokenService.hashToken(token);
    const provider = dto.provider;

    // The simulator must never be available in production.
    if (
      provider === PaymentProvider.TEST &&
      this.configService.get<string>('NODE_ENV') === 'production'
    ) {
      throw new ServiceUnavailableException(
        'The test payment provider is disabled in production.',
      );
    }

    // Read the session to locate the transaction. This read does not claim it.
    const session = await this.databaseService.checkoutSession.findUnique({
      where: { tokenHash },
      include: {
        transaction: true,
      },
    });

    if (
      !session ||
      session.status !== CheckoutSessionStatus.ACTIVE ||
      session.expiresAt <= new Date()
    ) {
      throw new NotFoundException(
        'Checkout link is invalid or unavailable.',
      );
    }

    const transaction = session.transaction;

    // Only a newly created transaction may begin a payment attempt.
    if (transaction.status !== PaymentStatus.CREATED) {
      throw new ConflictException(
        'This payment can no longer be initiated from this checkout link.',
      );
    }

    if (!transaction.customerPhone && !dto.phoneNumber.trim()) {
      throw new BadRequestException('A customer phone number is required.');
    }

    const phoneNumber = (
      transaction.customerPhone || dto.phoneNumber
    ).trim();

    // Resolve the adapter before claiming the session.
    const adapter = this.paymentProviderRegistry.get(provider);

    const attempt = await this.databaseService.$transaction(async (tx) => {
      // Claim the session first. Concurrent requests can claim it only once.
      const claimedSession = await tx.checkoutSession.updateMany({
        where: {
          id: session.id,
          status: CheckoutSessionStatus.ACTIVE,
          expiresAt: { gt: new Date() },
        },
        data: {
          status: CheckoutSessionStatus.CONSUMED,
          consumedAt: new Date(),
        },
      });

      if (claimedSession.count !== 1) {
        throw new ConflictException(
          'This checkout link has already been used or has expired.',
        );
      }

      // Atomically claim the transaction before making an external request.
      const claimedTransaction = await tx.paymentTransaction.updateMany({
        where: {
          id: transaction.id,
          status: PaymentStatus.CREATED,
          provider: null,
        },
        data: {
          status: PaymentStatus.PROCESSING,
          provider,
          customerPhone: phoneNumber,
        },
      });

      if (claimedTransaction.count !== 1) {
        throw new ConflictException(
          'Another request has already started this payment.',
        );
      }

      return tx.paymentAttempt.create({
        data: {
          transactionId: transaction.id,
          attemptNumber: 1,
          provider,
          status: PaymentAttemptStatus.STARTED,
        },
      });
    });

    // Do not hold a database transaction open during network I/O.
    const result = await adapter.initiatePayment({
      transactionReference: transaction.publicReference,
      attemptReference: attempt.id,
      amountTambala: transaction.amountTambala,
      currency: 'MWK',
      phoneNumber,
    });


    const status = await this.applyInitiationResult(
      transaction.id,
      attempt.id,
      result,
    );

    const message =
      status === PaymentStatus.SUCCEEDED
        ? 'Payment completed successfully.'
        : status === PaymentStatus.FAILED
          ? 'Payment failed or the provider rejected the request.'
          : status === PaymentStatus.PENDING_RECONCILIATION
            ? 'Payment outcome is uncertain and requires reconciliation.'
            : 'Payment request accepted. Awaiting customer completion.';

    return {
      reference: transaction.publicReference,
      status,
      provider,
      message,
    };

  }


  /**
   * Persist the provider's initiation response only if the attempt and
   * transaction are still awaiting that response.
   *
   * A provider callback may arrive before initiatePayment() returns.
   * Conditional updates prevent this response from overwriting that callback.
   */
  private async applyInitiationResult(
    transactionId: string,
    attemptId: string,
    result: ProviderInitiationResult,
  ): Promise<PaymentStatus> {
    const now = new Date();

    const isAccepted = result.outcome === 'ACCEPTED';
    const isRejected = result.outcome === 'REJECTED';

    const transactionStatus = isAccepted
      ? PaymentStatus.PROCESSING
      : isRejected
        ? PaymentStatus.FAILED
        : PaymentStatus.PENDING_RECONCILIATION;

    const attemptStatus = isAccepted
      ? PaymentAttemptStatus.PROCESSING
      : isRejected
        ? PaymentAttemptStatus.FAILED
        : PaymentAttemptStatus.UNKNOWN;

    try {
      const applied = await this.databaseService.$transaction(
        async (tx) => {
          // Only the original, unfinished attempt may consume this response.
          const attemptUpdate = await tx.paymentAttempt.updateMany({
            where: {
              id: attemptId,
              status: PaymentAttemptStatus.STARTED,
            },
            data: {
              status: attemptStatus,
              providerReference: isAccepted
                ? result.providerReference
                : undefined,
              failureCode: isAccepted ? null : result.failureCode,
              failureMessage: isAccepted ? null : result.failureMessage,
              completedAt: isAccepted ? null : now,
            },
          });

          // A callback may already have finalized the attempt.
          if (attemptUpdate.count !== 1) {
            return false;
          }

          // Never replace a transaction that is no longer PROCESSING.
          const transactionUpdate =
            await tx.paymentTransaction.updateMany({
              where: {
                id: transactionId,
                status: PaymentStatus.PROCESSING,
              },
              data: {
                status: transactionStatus,
                providerReference: isAccepted
                  ? result.providerReference
                  : undefined,
                failureCode: isAccepted ? null : result.failureCode,
                failureMessage: isAccepted ? null : result.failureMessage,
                processedAt: isAccepted ? null : now,
              },
            });

          if (transactionUpdate.count !== 1) {
            // Roll back the attempt update if the transaction has changed.
            throw new ConflictException(
              'Payment changed while applying the provider response.',
            );
          }

          return true;
        },
      );

      if (applied) {
        return transactionStatus;
      }
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        throw error;
      }
      // A callback may have won the race. Read the persisted status below.
    }

    // The response was stale or a callback already changed the payment.
    const current = await this.databaseService.paymentTransaction.findUnique({
      where: { id: transactionId },
      select: { status: true },
    });

    if (!current) {
      throw new NotFoundException('Payment transaction not found.');
    }

    return current.status;
  }

}
