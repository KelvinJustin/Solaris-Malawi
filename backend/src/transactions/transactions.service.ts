
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

  /**
   * Creates a merchant payment and its hosted checkout session.
   *
   * The idempotency key is the business boundary for duplicate submission. If the
   * same key is reused with the same payload, the service returns the original
   * checkout result. If the payload differs, it fails fast instead of silently
   * accepting a split-brain payment request.
   */
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
   * Finds the previously created payment using the merchant-scoped idempotency
   * key.
   *
   * The query intentionally includes the latest active checkout session so the
   * service can recover the original hosted link instead of creating a duplicate.
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
   * Rejects a reused idempotency key when the payload differs from the original
   * payment request.
   *
   * This is a safety check for accidental retries and duplicate submissions. It
   * keeps the payment creation API deterministic and prevents a second request
   * from mutating the meaning of the original transaction.
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
   * Returns the original checkout response when the previous session is still
   * valid.
   *
   * If the session has expired or been consumed, the method does not fabricate a
   * new checkout URL; it exposes the current state instead so the caller can
   * decide how to recover.
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

  /**
   * Sets a fixed checkout lifetime so a hosted payment link cannot remain active
   * forever while the merchant or customer is still navigating the flow.
   */
  private getSessionExpiry(): Date {
    return new Date(Date.now() + CHECKOUT_SESSION_MINUTES * 60 * 1000);
  }

  /**
   * Builds the public checkout URL for the hosted payment flow.
   *
   * The base URL is validated to ensure that checkout links are only generated for
   * a trusted HTTPS origin, which helps avoid open redirects or unsafe payment
   * flows.
   */
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
   * Retrieves a transaction by the merchant-scoped public reference.
   *
   * The public reference is the stable identifier exposed to the frontend and is
   * intentionally not the internal primary key used by Prisma.
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
   * Validates a hosted checkout token and returns the payment metadata that the
   * customer sees before provider selection.
   *
   * Only the hashed token is stored in the database; the raw value is never
   * persisted or written to logs. Expired or invalid links are rejected before
   * payment initiation begins.
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
   * Begins one provider attempt for an active hosted checkout session.
   *
   * The checkout link and transaction are claimed atomically before any network
   * request is made. This prevents two concurrent requests from starting the
   * same payment and keeps provider callbacks deterministic.
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
   * Persists the provider's initiation response only if the attempt and
   * transaction are still awaiting that response.
   *
   * A provider callback can arrive before the HTTP call returns. The guarded
   * update logic keeps the callback result authoritative when the two race each
   * other.
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
