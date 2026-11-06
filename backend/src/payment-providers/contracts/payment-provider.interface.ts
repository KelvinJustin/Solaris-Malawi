
import { PaymentProvider } from '../../generated/prisma/enums.js';

/**
 * Information solaris supplies when asking a provider to initiate a payment.
 *
 * Amounts are expressed in tambala, not MWK decimal values.
 */
export interface InitiatePaymentInput {
    /** Solaris's stable public transaction reference. */
    transactionReference: string;

    /** Unique identifier for this particular payment attempt. */
    attemptReference: string;

    /** Amount in integer tambala (100 tambala = MWK 1.00). */
    amountTambala: number;

    /** Solaris currently supports Malawian kwacha only. */
    currency: 'MWK';

    /** Normalized Malawian mobile number. */
    phoneNumber: string;
}

/**
 * Result of the provider's initiation request.
 *
 * ACCEPTED means the provider accepted the request, not that
 * the customer completed payment.
 *
 * UNKNOWN means the outcome cannot safely be determined.
 */
export type ProviderInitiationResult =
    | {
        outcome: 'ACCEPTED';
        providerReference: string;
    }
    | {
        outcome: 'REJECTED';
        failureCode: string;
        failureMessage: string;
    }
    | {
        outcome: 'UNKNOWN';
        failureCode: string;
        failureMessage: string;
    };

/**
 * Contract every real or mock payment provider must implement.
 *
 * Provider-specific HTTP requests, authentication, and response
 * parsing belong inside the relevant adapter.
 */
export interface PaymentProviderAdapter {
    readonly provider: PaymentProvider;

    initiatePayment(
        input: InitiatePaymentInput,
    ): Promise<ProviderInitiationResult>;
}
