import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyNowPaymentsIpnSignature } from './nowpayments-ipn.util.js';

const secret = 'nowpayments-ipn-test-secret';

function sign(payload: unknown): string {
  return createHmac('sha512', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
}

describe('verifyNowPaymentsIpnSignature', () => {
  it('verifies a signature over the recursively sorted payload', () => {
    const payload = {
      payment_status: 'finished',
      nested: { z: 1, a: 2 },
      payment_id: 'payment-123',
    };
    const canonicalPayload = {
      nested: { a: 2, z: 1 },
      payment_id: 'payment-123',
      payment_status: 'finished',
    };

    expect(
      verifyNowPaymentsIpnSignature(payload, sign(canonicalPayload), secret),
    ).toBe(true);
  });

  it('rejects missing, malformed, and mismatched signatures', () => {
    const payload = { payment_id: 'payment-123' };

    expect(verifyNowPaymentsIpnSignature(payload, undefined, secret)).toBe(
      false,
    );
    expect(verifyNowPaymentsIpnSignature(payload, 'not-hex', secret)).toBe(
      false,
    );
    expect(verifyNowPaymentsIpnSignature(payload, sign(payload), 'wrong')).toBe(
      false,
    );
    expect(
      verifyNowPaymentsIpnSignature(
        { ...payload, payment_status: 'failed' },
        sign(payload),
        secret,
      ),
    ).toBe(false);
  });
});
