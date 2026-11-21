import { PaymentAttemptStatus, PaymentStatus } from '../../../generated/prisma/enums.js';

export type NowPaymentsStatus =
  | 'waiting'
  | 'confirming'
  | 'confirmed'
  | 'sending'
  | 'partially_paid'
  | 'finished'
  | 'failed'
  | 'expired'
  | 'refunded';

export interface MappedCryptoStatus {
  attemptStatus: PaymentAttemptStatus;
  transactionStatus: PaymentStatus;
  /** True once this is a status we should stop expecting further progress updates for, absent a dispute. */
  isTerminal: boolean;
}

/**
 * Maps NOWPayments' payment_status to our internal statuses.
 *
 * Two deliberate decisions worth calling out:
 *
 * - `partially_paid` is NOT success. A customer who sends less than the
 *   quoted amount (common with volatile gas fees or clients that round
 *   badly) has not completed the payment, and crediting a merchant for less
 *   than they're owed is a different problem than crediting them on time.
 *   It goes to PENDING_RECONCILIATION so a human decides the policy
 *   (request the shortfall, accept a partial fulfillment, refund).
 *
 * - `refunded` arriving AFTER we've already recorded `finished` is not
 *   something this function reverses. We do not map a success back to a
 *   failure here — that would silently corrupt a transaction that may
 *   already be posted to the ledger. The guarded update in
 *   provider-callbacks.service.ts (matching only `where: { status:
 *   PaymentStatus.PROCESSING }`) will simply no-op once the transaction has
 *   already reached SUCCEEDED, and the event still lands in
 *   CryptoPaymentIpnEvent for a human to action as a ledger reversal.
 */
export function mapNowPaymentsStatus(status: NowPaymentsStatus): MappedCryptoStatus {
  switch (status) {
    case 'waiting':
    case 'confirming':
    case 'confirmed':
    case 'sending':
      return {
        attemptStatus: PaymentAttemptStatus.PROCESSING,
        transactionStatus: PaymentStatus.PROCESSING,
        isTerminal: false,
      };
    case 'partially_paid':
      return {
        attemptStatus: PaymentAttemptStatus.UNKNOWN,
        transactionStatus: PaymentStatus.PENDING_RECONCILIATION,
        isTerminal: false,
      };
    case 'finished':
      return {
        attemptStatus: PaymentAttemptStatus.SUCCEEDED,
        transactionStatus: PaymentStatus.SUCCEEDED,
        isTerminal: true,
      };
    case 'failed':
    case 'expired':
      return {
        attemptStatus: PaymentAttemptStatus.FAILED,
        transactionStatus: PaymentStatus.FAILED,
        isTerminal: true,
      };
    case 'refunded':
      // Already-terminal by definition — something was finished, then reversed.
      return {
        attemptStatus: PaymentAttemptStatus.UNKNOWN,
        transactionStatus: PaymentStatus.PENDING_RECONCILIATION,
        isTerminal: true,
      };
    default:
      return {
        attemptStatus: PaymentAttemptStatus.UNKNOWN,
        transactionStatus: PaymentStatus.PENDING_RECONCILIATION,
        isTerminal: false,
      };
  }
}