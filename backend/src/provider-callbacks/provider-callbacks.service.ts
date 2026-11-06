
import {
    BadRequestException,
    ConflictException,
    Injectable,
    InternalServerErrorException,
    UnauthorizedException,
} from '@nestjs/common';
import {
    PaymentAttemptStatus,
    PaymentStatus,
} from '../generated/prisma/enums.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import {
    ProviderCallbackDto,
    ProviderCallbackStatus,
} from './dto/provider-callback.dto.js';

interface CallbackInput {
    body: ProviderCallbackDto;
    rawBody: Buffer;
    timestamp?: string;
    signature?: string;
}

@Injectable()
export class ProviderCallbacksService {
    private readonly maxTimestampAgeMs = 5 * 60 * 1000;

    constructor(private readonly database: DatabaseService) { }

    async handleCallback(input: CallbackInput) {
        this.verifySignature(input);

        const { body } = input;

        if (body.event !== 'payment.updated') {
            throw new BadRequestException('Unsupported callback event');
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
                include: { transaction: true },
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
                transaction.amountTambala !== Math.round(amountInTambala) ||
                transaction.currency !== body.currency ||
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
                        expectedStatus === PaymentStatus.FAILED
                            ? body.failureCode
                            : null,
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

                throw new ConflictException(
                    'Payment attempt has already changed.',
                );
            }

            // Only finalize the transaction if it is still awaiting a result.
            const updatedTransaction =
                await tx.paymentTransaction.updateMany({
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
                            expectedStatus === PaymentStatus.FAILED
                                ? body.failureCode
                                : null,
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

            return { received: true, duplicate: false };

        });
    }

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
            secret || (process.env.NODE_ENV === 'production'
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
}
