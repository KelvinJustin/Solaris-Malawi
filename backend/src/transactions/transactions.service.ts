import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import {
  PaymentAttemptStatus,
  PaymentProvider,
  PaymentStatus,
  CheckoutSessionStatus,
  AccountStatus,
  PaymentType,
} from '../generated/prisma/enums.js';

import { PaymentProviderRegistry } from '../payment-providers/registry/payment-provider.registry.js';
import { InitiateCheckoutPaymentDto } from './dto/initiate-checkout-payment.dto.js';
import type { ProviderInitiationResult } from '../payment-providers/contracts/payment-provider.interface.js';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { CheckoutTokenService } from './checkout-token.service.js';
import { FeePolicyService } from '../ledger/fee-policy.service.js';
import {
  formatCryptoAmount,
  resolveNowPaymentsCurrency,
} from '../ledger/crypto-asset.util.js';

// TODO: Add production logging for idempotency race conditions.

const CHECKOUT_SESSION_MINUTES = 30;

type CommonPaymentRequest = {
  customerPhone: string | null;
  description: string | null;
  merchantReference: string | null;
};

type NormalizedPaymentRequest =
  | (CommonPaymentRequest & {
      paymentType: typeof PaymentType.MWK;
      amountTambala: number;
      currency: 'MWK';
    })
  | (CommonPaymentRequest & {
      paymentType: typeof PaymentType.CRYPTO;
      provider: typeof PaymentProvider.NOWPAYMENTS;
      asset: string;
      network: string | null;
      amount: string;
      providerCurrency: string;
    });

type PaymentWithDetails = {
  id: string;
  publicReference: string;
  status: PaymentStatus;
  paymentType: PaymentType;
  provider: PaymentProvider | null;
  customerPhone: string | null;
  description: string | null;
  merchantReference: string | null;
  mwkDetail: { amountTambala: number; currency: string } | null;
  cryptoDetail: {
    asset: string;
    network: string | null;
    requestedAmount: Prisma.Decimal;
  } | null;
};

type ExistingPayment = PaymentWithDetails & {
  checkoutSessions: {
    tokenEncrypted: string;
    expiresAt: Date;
  }[];
};

@Injectable()
export class TransactionsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly checkoutTokenService: CheckoutTokenService,
    private readonly configService: ConfigService,
    private readonly paymentProviderRegistry: PaymentProviderRegistry,
    private readonly feePolicyService: FeePolicyService,
  ) {}

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

    const paymentType = dto.paymentType ?? PaymentType.MWK;
    const commonData = {
      customerPhone: dto.customerPhone?.trim() || null,
      description: dto.description?.trim() || null,
      merchantReference: dto.merchantReference?.trim() || null,
    };

    let requestData: NormalizedPaymentRequest;

    if (paymentType === PaymentType.MWK) {
      if (dto.amountTambala === undefined || dto.amount !== undefined) {
        throw new BadRequestException(
          'MWK payments require amountTambala and do not accept amount.',
        );
      }
      if (
        dto.provider !== undefined ||
        dto.asset !== undefined ||
        dto.network !== undefined
      ) {
        throw new BadRequestException(
          'Crypto payment fields are only valid when paymentType is CRYPTO.',
        );
      }
      requestData = {
        paymentType,
        amountTambala: dto.amountTambala,
        currency: 'MWK',
        ...commonData,
      };
    } else {
      if (
        dto.amount === undefined ||
        dto.amountTambala !== undefined ||
        dto.provider !== PaymentProvider.NOWPAYMENTS ||
        !dto.asset
      ) {
        throw new BadRequestException(
          'Crypto payments require provider NOWPAYMENTS, asset, and decimal-string amount.',
        );
      }

      const asset = dto.asset.trim().toUpperCase();
      const network = dto.network?.trim().toUpperCase() || null;
      const providerCurrency = resolveNowPaymentsCurrency(asset, network);
      if (!providerCurrency) {
        throw new BadRequestException(
          `The asset/network pair ${asset}/${network ?? 'NATIVE'} is not supported.`,
        );
      }

      const amount = this.normalizeCryptoAmount(dto.amount);
      requestData = {
        paymentType,
        provider: PaymentProvider.NOWPAYMENTS,
        asset,
        network,
        amount,
        providerCurrency,
        ...commonData,
      };
    }

    const normalizedRequest = requestData;
    const existing = await this.findByIdempotencyKey(merchantId, key);
    if (existing) {
      this.assertSameRequest(existing, normalizedRequest);
      return this.getCheckoutResponse(existing);
    }

    // Prepare the first checkout session.
    const token = this.checkoutTokenService.createToken();
    const expiresAt = this.getSessionExpiry();
    const checkoutUrl = this.buildCheckoutUrl(token.token);

    try {
      // The transaction and session either both persist or neither does.
      const payment = await this.databaseService.$transaction(async (tx) => {
        const transaction =
          normalizedRequest.paymentType === PaymentType.MWK
            ? await (async () => {
                const feeSnapshot =
                  await this.feePolicyService.snapshotForPayment(tx, {
                    merchantId,
                    currency: normalizedRequest.currency,
                    amountTambala: BigInt(normalizedRequest.amountTambala),
                  });
                return tx.paymentTransaction.create({
                  data: {
                    publicReference: `sp_${randomUUID().replaceAll('-', '')}`,
                    merchantId,
                    paymentType: PaymentType.MWK,
                    customerPhone: normalizedRequest.customerPhone,
                    description: normalizedRequest.description,
                    merchantReference: normalizedRequest.merchantReference,
                    idempotencyKey: key,
                    status: PaymentStatus.CREATED,
                    mwkDetail: {
                      create: {
                        amountTambala: normalizedRequest.amountTambala,
                        ...feeSnapshot,
                      },
                    },
                  },
                  include: { mwkDetail: true, cryptoDetail: true },
                });
              })()
            : await tx.paymentTransaction.create({
                data: {
                  publicReference: `sp_${randomUUID().replaceAll('-', '')}`,
                  merchantId,
                  paymentType: PaymentType.CRYPTO,
                  provider: PaymentProvider.NOWPAYMENTS,
                  customerPhone: normalizedRequest.customerPhone,
                  description: normalizedRequest.description,
                  merchantReference: normalizedRequest.merchantReference,
                  idempotencyKey: key,
                  status: PaymentStatus.CREATED,
                  cryptoDetail: {
                    create: {
                      asset: normalizedRequest.asset,
                      network: normalizedRequest.network,
                      requestedAmount: normalizedRequest.amount,
                      providerCurrency: normalizedRequest.providerCurrency,
                    },
                  },
                },
                include: { mwkDetail: true, cryptoDetail: true },
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
        ...this.paymentAmountResponse(payment),
        checkout_url: checkoutUrl,
        expires_at: expiresAt,
      };
    } catch (error) {
      // A concurrent request may have created the transaction first.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrent = await this.findByIdempotencyKey(merchantId, key);

        if (concurrent) {
          this.assertSameRequest(concurrent, normalizedRequest);
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
        mwkDetail: true,
        cryptoDetail: true,
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
    existing: ExistingPayment,
    requestData: NormalizedPaymentRequest,
  ): void {
    const sameCommonFields =
      existing.customerPhone === requestData.customerPhone &&
      existing.description === requestData.description &&
      existing.merchantReference === requestData.merchantReference;

    const sameAmount =
      requestData.paymentType === PaymentType.MWK
        ? existing.paymentType === PaymentType.MWK &&
          existing.mwkDetail?.amountTambala === requestData.amountTambala
        : existing.paymentType === PaymentType.CRYPTO &&
          existing.provider === PaymentProvider.NOWPAYMENTS &&
          existing.cryptoDetail?.asset === requestData.asset &&
          existing.cryptoDetail?.network === requestData.network &&
          existing.cryptoDetail !== null &&
          existing.cryptoDetail.requestedAmount.equals(requestData.amount);

    const sameRequest =
      sameCommonFields &&
      existing.paymentType === requestData.paymentType &&
      sameAmount;

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
  private async getCheckoutResponse(transaction: ExistingPayment) {
    const now = new Date();
    const session = transaction.checkoutSessions[0];

    if (session && session.expiresAt > now) {
      const token = this.checkoutTokenService.decryptToken(
        session.tokenEncrypted,
      );

      return {
        ...this.paymentAmountResponse(transaction),
        checkout_url: this.buildCheckoutUrl(token),
        expires_at: session.expiresAt,
      };
    }

    // Do not reopen a payment that is already processing, succeeded,
    // failed, or awaiting reconciliation. Recovery needs a separate policy.
    return {
      ...this.paymentAmountResponse(transaction),
      checkout_url: null,
      expires_at: null,
    };
  }

  private paymentAmountResponse(transaction: PaymentWithDetails) {
    if (transaction.paymentType === PaymentType.MWK && transaction.mwkDetail) {
      return {
        publicReference: transaction.publicReference,
        status: transaction.status,
        amountTambala: transaction.mwkDetail.amountTambala,
        currency: transaction.mwkDetail.currency,
      };
    }
    if (
      transaction.paymentType === PaymentType.CRYPTO &&
      transaction.cryptoDetail
    ) {
      return {
        publicReference: transaction.publicReference,
        status: transaction.status,
        paymentType: PaymentType.CRYPTO,
        provider: PaymentProvider.NOWPAYMENTS,
        asset: transaction.cryptoDetail.asset,
        network: transaction.cryptoDetail.network,
        amount: formatCryptoAmount(
          transaction.cryptoDetail.requestedAmount.toFixed(),
        ),
      };
    }
    throw new InternalServerErrorException(
      'Payment transaction is missing its matching financial detail.',
    );
  }

  private normalizeCryptoAmount(amount: string): string {
    if (!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/.test(amount)) {
      throw new BadRequestException(
        'Crypto amount must be a positive decimal string with at most 18 fractional digits.',
      );
    }
    const decimal = new Prisma.Decimal(amount);
    if (!decimal.isPositive()) {
      throw new BadRequestException('Crypto amount must be greater than zero.');
    }
    const [whole, fraction] = amount.split('.');
    const normalizedFraction = fraction?.replace(/0+$/, '');
    return normalizedFraction
      ? `${BigInt(whole).toString()}.${normalizedFraction}`
      : BigInt(whole).toString();
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
        throw new Error(
          'The checkout base URL must not contain a query string or hash.',
        );
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
    const transaction = await this.databaseService.paymentTransaction.findFirst(
      {
        where: {
          publicReference: reference,
          merchantId,
        },
        select: {
          publicReference: true,
          paymentType: true,
          mwkDetail: { select: { amountTambala: true, currency: true } },
          cryptoDetail: {
            select: { asset: true, network: true, requestedAmount: true },
          },
          status: true,
          provider: true,
          description: true,
          merchantReference: true,
          createdAt: true,
          processedAt: true,
        },
      },
    );

    if (!transaction) {
      throw new NotFoundException('Transaction not found.');
    }

    if (transaction.paymentType === PaymentType.MWK && transaction.mwkDetail) {
      return {
        publicReference: transaction.publicReference,
        amountTambala: transaction.mwkDetail.amountTambala,
        currency: transaction.mwkDetail.currency,
        status: transaction.status,
        provider: transaction.provider,
        description: transaction.description,
        merchantReference: transaction.merchantReference,
        createdAt: transaction.createdAt,
        processedAt: transaction.processedAt,
      };
    }
    if (
      transaction.paymentType === PaymentType.CRYPTO &&
      transaction.cryptoDetail
    ) {
      return {
        publicReference: transaction.publicReference,
        paymentType: PaymentType.CRYPTO,
        provider: PaymentProvider.NOWPAYMENTS,
        asset: transaction.cryptoDetail.asset,
        network: transaction.cryptoDetail.network,
        amount: formatCryptoAmount(
          transaction.cryptoDetail.requestedAmount.toFixed(),
        ),
        status: transaction.status,
        description: transaction.description,
        merchantReference: transaction.merchantReference,
        createdAt: transaction.createdAt,
        processedAt: transaction.processedAt,
      };
    }
    throw new InternalServerErrorException(
      'Payment transaction is missing its matching financial detail.',
    );
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
          include: { mwkDetail: true, cryptoDetail: true },
        },
      },
    });

    // Use the same response for unknown and unavailable links.
    if (!session || session.status !== CheckoutSessionStatus.ACTIVE) {
      throw new NotFoundException('Checkout link is invalid or unavailable.');
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

      throw new NotFoundException('Checkout link is invalid or unavailable.');
    }

    const transaction = session.transaction;

    const payment = this.paymentAmountResponse(transaction);
    const { publicReference: _publicReference, ...paymentDetails } = payment;
    return {
      reference: transaction.publicReference,
      ...paymentDetails,
      description: transaction.description,
      canPay: transaction.status === PaymentStatus.CREATED,
    };
  }

  /**
   * Begins one provider attempt for an active hosted checkout session.
   *
   * The checkout link and transaction are claimed atomically before any network
   * request is made. This prevents two concurrent requests from starting the
   * same payment and keeps provider callbacks deterministic.
   *
   * Mobile-money and crypto diverge sharply here: mobile money needs a phone
   * number and nothing else, and its provider call resolves synchronously
   * (accept/reject). Crypto needs a pay currency instead of a phone number,
   * and "ACCEPTED" only means an invoice/address was generated — the real
   * outcome arrives later via the NOWPayments IPN webhook. Both still share
   * the same claim-then-call-then-reconcile skeleton, so the branching is
   * kept local to this method rather than duplicating the whole flow.
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
        transaction: {
          include: { mwkDetail: true, cryptoDetail: true },
        },
      },
    });

    if (
      !session ||
      session.status !== CheckoutSessionStatus.ACTIVE ||
      session.expiresAt <= new Date()
    ) {
      throw new NotFoundException('Checkout link is invalid or unavailable.');
    }

    const transaction = session.transaction;

    // Only a newly created transaction may begin a payment attempt.
    if (transaction.status !== PaymentStatus.CREATED) {
      throw new ConflictException(
        'This payment can no longer be initiated from this checkout link.',
      );
    }

    const isCrypto = transaction.paymentType === PaymentType.CRYPTO;
    if (
      (isCrypto && provider !== PaymentProvider.NOWPAYMENTS) ||
      (!isCrypto && provider === PaymentProvider.NOWPAYMENTS)
    ) {
      throw new BadRequestException(
        'The selected provider does not match this transaction payment type.',
      );
    }

    let phoneNumber: string | undefined;

    if (!isCrypto) {
      if (!transaction.customerPhone && !dto.phoneNumber?.trim()) {
        throw new BadRequestException('A customer phone number is required.');
      }

      phoneNumber = (transaction.customerPhone || dto.phoneNumber)!.trim();
    }

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
          provider: isCrypto ? PaymentProvider.NOWPAYMENTS : null,
        },
        data: {
          status: PaymentStatus.PROCESSING,
          provider,
          customerPhone: phoneNumber ?? transaction.customerPhone,
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
    const mwkDetail = transaction.mwkDetail;
    const cryptoDetail = transaction.cryptoDetail;
    if (isCrypto && !cryptoDetail) {
      throw new InternalServerErrorException(
        'Crypto transaction is missing its crypto payment detail.',
      );
    }
    if (!isCrypto && !mwkDetail) {
      throw new InternalServerErrorException(
        'MWK transaction is missing its MWK payment detail.',
      );
    }

    const result: ProviderInitiationResult = isCrypto
      ? await adapter.initiatePayment({
          provider: PaymentProvider.NOWPAYMENTS,
          transactionReference: transaction.publicReference,
          attemptReference: attempt.id,
          transactionId: transaction.id,
          requestedAmount: formatCryptoAmount(
            cryptoDetail!.requestedAmount.toFixed(),
          ),
          providerCurrency: cryptoDetail!.providerCurrency,
          asset: cryptoDetail!.asset,
          network: cryptoDetail!.network,
        })
      : await adapter.initiatePayment({
          provider: provider as Exclude<
            PaymentProvider,
            typeof PaymentProvider.NOWPAYMENTS
          >,
          transactionReference: transaction.publicReference,
          attemptReference: attempt.id,
          amountTambala: mwkDetail!.amountTambala,
          currency: 'MWK',
          phoneNumber: phoneNumber!,
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

    const response: {
      reference: string;
      status: PaymentStatus;
      provider: PaymentProvider;
      message: string;
      payment_instructions?: {
        paymentAddress: string;
        payAmount: string;
        asset: string;
        network: string | null;
        expiresAt: Date | null;
      };
    } = {
      reference: transaction.publicReference,
      status,
      provider,
      message,
    };

    // Crypto has no synchronous "paid" moment to report back — the first
    // response IS the payment instructions. Only attach them when the
    // invoice was actually created; a REJECTED/UNKNOWN crypto result has
    // nothing to show the customer.
    if (
      isCrypto &&
      result.outcome === 'ACCEPTED' &&
      'paymentAddress' in result
    ) {
      response.payment_instructions = {
        paymentAddress: result.paymentAddress,
        payAmount: result.payAmount,
        asset: result.asset,
        network: result.network,
        expiresAt: result.expiresAt,
      };
    }

    return response;
  }

  /**
   * Persists the provider's initiation response only if the attempt and
   * transaction are still awaiting that response.
   *
   * A provider callback can arrive before the HTTP call returns. The guarded
   * update logic keeps the callback result authoritative when the two race each
   * other.
   *
   * For mobile money this callback is the provider's synchronous HTTP
   * response. For crypto it is still just the "invoice created" response —
   * ACCEPTED here means PROCESSING, not SUCCEEDED. The NOWPayments webhook
   * handler in provider-callbacks is what later moves a crypto
   * transaction from PROCESSING to SUCCEEDED/FAILED, using this exact same
   * guarded-update idiom so the two can never race each other into a bad
   * state.
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
      const applied = await this.databaseService.$transaction(async (tx) => {
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
        const transactionUpdate = await tx.paymentTransaction.updateMany({
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
      });

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
