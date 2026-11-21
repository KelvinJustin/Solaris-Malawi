import { afterEach, describe, expect, it } from 'vitest';
import nowpaymentsConfig from './nowpayments.config.js';

const originalFeeBps = process.env.NOWPAYMENTS_FEE_BPS;

afterEach(() => {
  if (originalFeeBps === undefined) {
    delete process.env.NOWPAYMENTS_FEE_BPS;
  } else {
    process.env.NOWPAYMENTS_FEE_BPS = originalFeeBps;
  }
});

describe('NOWPayments configuration', () => {
  it('defaults the crypto fee to zero and accepts an integer basis-point rate', () => {
    delete process.env.NOWPAYMENTS_FEE_BPS;
    expect(nowpaymentsConfig().cryptoFeeBps).toBe(0);

    process.env.NOWPAYMENTS_FEE_BPS = '275';
    expect(nowpaymentsConfig().cryptoFeeBps).toBe(275);
  });

  it.each(['-1', '10000', '2.5', 'not-a-number'])(
    'rejects invalid NOWPAYMENTS_FEE_BPS value %s',
    (value) => {
      process.env.NOWPAYMENTS_FEE_BPS = value;
      expect(() => nowpaymentsConfig()).toThrow(
        'NOWPAYMENTS_FEE_BPS must be an integer from 0 to 9999.',
      );
    },
  );
});
