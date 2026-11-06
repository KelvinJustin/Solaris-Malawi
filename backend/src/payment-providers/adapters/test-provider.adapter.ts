
import {
    Injectable,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PaymentProvider } from '../../generated/prisma/enums.js';
import type {
    InitiatePaymentInput,
    PaymentProviderAdapter,
    ProviderInitiationResult,
} from '../contracts/payment-provider.interface.js';

/**
 * HTTP adapter for the standalone Solaris test-provider simulator.
 *
 * This adapter is for development and integration testing only.
 * It does not connect to Airtel Money or TNM production systems.
 */
@Injectable()
export class TestProviderAdapter implements PaymentProviderAdapter {
    constructor(
        private readonly configService: ConfigService,
        readonly provider: PaymentProvider,
    ) { }

    /**
     * Ask the simulator to initiate a payment.
     *
     * A timeout or server error is treated as UNKNOWN because the
     * simulator may have accepted the request before the error occurred.
     */
    async initiatePayment(
        input: InitiatePaymentInput,
    ): Promise<ProviderInitiationResult> {
        const baseUrl = this.configService
            .get<string>('TEST_PROVIDER_BASE_URL')
            ?.trim()
            .replace(/\/+$/, '');

        if (!baseUrl) {
            throw new ServiceUnavailableException(
                'TEST_PROVIDER_BASE_URL is not configured.',
            );
        }

        const amountKwacha = Number(
            (input.amountTambala / 100).toFixed(2),
        );

        let response: Response;

        try {
            response = await fetch(`${baseUrl}/initiate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify({
                    transactionReference: input.transactionReference,
                    attemptReference: input.attemptReference,
                    amount: amountKwacha,
                    currency: input.currency,
                    phoneNumber: input.phoneNumber,
                    provider: this.provider,
                }),
                signal: AbortSignal.timeout(10_000),
            });
        } catch {
            // A network error or timeout does not prove the payment failed.
            return {
                outcome: 'UNKNOWN',
                failureCode: 'PROVIDER_CONNECTION_ERROR',
                failureMessage:
                    'The test provider could not be reached or timed out.',
            };
        }

        let body: Record<string, unknown>;

        try {
            body = await response.json() as Record<string, unknown>;
        } catch {
            return {
                outcome: 'UNKNOWN',
                failureCode: 'INVALID_PROVIDER_RESPONSE',
                failureMessage: 'The test provider returned invalid JSON.',
            };
        }

        // A server error may occur after the provider has accepted a request.
        if (response.status >= 500) {
            return {
                outcome: 'UNKNOWN',
                failureCode: 'PROVIDER_SERVER_ERROR',
                failureMessage: 'The test provider returned a server error.',
            };
        }

        // A client error means the simulator rejected the request.
        if (!response.ok) {
            return {
                outcome: 'REJECTED',
                failureCode:
                    typeof body.failureCode === 'string'
                        ? body.failureCode
                        : 'PROVIDER_REQUEST_REJECTED',
                failureMessage:
                    typeof body.message === 'string'
                        ? body.message
                        : 'The test provider rejected the request.',
            };
        }

        // A successful HTTP response only means ACCEPTED if it contains
        // a usable provider reference. It does not mean the payment succeeded.
        if (
            typeof body.providerReference !== 'string' ||
            body.providerReference.length === 0
        ) {
            return {
                outcome: 'UNKNOWN',
                failureCode: 'INVALID_PROVIDER_RESPONSE',
                failureMessage:
                    'The test provider response did not contain a provider reference.',
            };
        }

        return {
            outcome: 'ACCEPTED',
            providerReference: body.providerReference,
        };
    }
}
