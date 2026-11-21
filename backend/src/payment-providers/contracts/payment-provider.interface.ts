
import { PaymentProvider } from '../../generated/prisma/enums.js';

/**
 * Providers that initiate mobile-money payments.
 */
type MobileMoneyProvider =
    | typeof PaymentProvider.AIRTEL_MONEY
    | typeof PaymentProvider.TN_MPAMBA
    | typeof PaymentProvider.TEST;

/**
 * Mobile-money initiation input.
 */
export interface MobileMoneyInitiationInput {
    provider: MobileMoneyProvider;
    transactionReference: string;
    attemptReference: string;
    amountTambala: number;
    currency: 'MWK';
    phoneNumber: string;
}

/**
 * Crypto initiation input.
 *
 * The merchant transaction remains denominated in MWK.
 */
export interface CryptoInitiationInput {
    provider: typeof PaymentProvider.NOWPAYMENTS;
    transactionReference: string;
    attemptReference: string;
    amountTambala: number;
    currency: 'MWK';
    payCurrency: string;
    network: string;
}

/**
 * Common input accepted by payment-provider adapters.
 */
export type InitiatePaymentInput =
    | MobileMoneyInitiationInput
    | CryptoInitiationInput;

/**
 * Mobile-money initiation results.
 */
export type MobileMoneyInitiationResult =
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
 * Crypto initiation results.
 *
 * ACCEPTED means payment instructions were created,
 * not that the customer completed payment.
 */
export type CryptoInitiationResult =
    | {
        outcome: 'ACCEPTED';
        providerReference: string;
        paymentAddress: string;
        payAmount: string;
        payCurrency: string;
        network: string;
        expiresAt: Date | null;
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
 * Common result returned by provider adapters.
 */
export type ProviderInitiationResult =
    | MobileMoneyInitiationResult
    | CryptoInitiationResult;

/**
 * Contract implemented by all payment-provider adapters.
 */
export interface PaymentProviderAdapter {
    readonly provider: PaymentProvider;

    initiatePayment(
        input: InitiatePaymentInput,
    ): Promise<ProviderInitiationResult>;
}
