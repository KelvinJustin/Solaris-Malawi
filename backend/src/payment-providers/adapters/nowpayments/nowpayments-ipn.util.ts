import { createHmac, timingSafeEqual } from 'node:crypto';

/** Recursively sorts object keys alphabetically. Arrays keep their order; only object keys are sorted. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Verifies a NOWPayments IPN payload against the x-nowpayments-sig header.
 * Returns false on any malformed input rather than throwing, so callers have
 * one simple branch: verified or not.
 */
export function verifyNowPaymentsIpnSignature(
  parsedBody: unknown,
  signatureHeader: string | undefined,
  ipnSecret: string,
): boolean {
  if (!signatureHeader || !ipnSecret) {
    return false;
  }

  const canonical = JSON.stringify(sortKeysDeep(parsedBody));
  const expected = createHmac('sha512', ipnSecret).update(canonical).digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(signatureHeader, 'hex');

  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }

  return timingSafeEqual(expectedBuf, actualBuf);
}