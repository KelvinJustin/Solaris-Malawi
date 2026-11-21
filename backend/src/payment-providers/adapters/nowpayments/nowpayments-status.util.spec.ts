import {
  PaymentAttemptStatus,
  PaymentStatus,
} from '../../../generated/prisma/enums.js';
import { describe, expect, it } from 'vitest';
import { mapNowPaymentsStatus } from './nowpayments-status.util.js';

describe('mapNowPaymentsStatus', () => {
  it('keeps in-progress provider statuses processing', () => {
    expect(mapNowPaymentsStatus('confirming')).toEqual({
      attemptStatus: PaymentAttemptStatus.PROCESSING,
      transactionStatus: PaymentStatus.PROCESSING,
      isTerminal: false,
    });
  });

  it('does not treat partial payment as success', () => {
    expect(mapNowPaymentsStatus('partially_paid')).toEqual({
      attemptStatus: PaymentAttemptStatus.UNKNOWN,
      transactionStatus: PaymentStatus.PENDING_RECONCILIATION,
      isTerminal: false,
    });
  });

  it('marks finished payments successful and refunded payments for review', () => {
    expect(mapNowPaymentsStatus('finished')).toEqual({
      attemptStatus: PaymentAttemptStatus.SUCCEEDED,
      transactionStatus: PaymentStatus.SUCCEEDED,
      isTerminal: true,
    });
    expect(mapNowPaymentsStatus('refunded')).toEqual({
      attemptStatus: PaymentAttemptStatus.UNKNOWN,
      transactionStatus: PaymentStatus.PENDING_RECONCILIATION,
      isTerminal: true,
    });
  });
});
