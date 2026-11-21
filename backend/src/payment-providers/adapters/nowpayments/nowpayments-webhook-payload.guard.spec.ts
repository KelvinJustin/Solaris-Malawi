import { describe, expect, it } from 'vitest';
import { isNowPaymentsIpnPayload } from './nowpayments-webhook-payload.guard.js';

describe('isNowPaymentsIpnPayload', () => {
  it('accepts a supported status with a numeric paid amount', () => {
    expect(
      isNowPaymentsIpnPayload({
        payment_id: 'np-payment-1',
        payment_status: 'finished',
        actually_paid: 0.00012,
      }),
    ).toBe(true);
  });

  it.each([
    { payment_id: '', payment_status: 'finished' },
    { payment_id: 'np-1', payment_status: 'unknown' },
    { payment_id: 'np-1', payment_status: 'finished', actually_paid: '0.1' },
    { payment_id: 'np-1', payment_status: 'finished', actually_paid: Infinity },
  ])('rejects invalid IPN shape %#', (payload) => {
    expect(isNowPaymentsIpnPayload(payload)).toBe(false);
  });
});
