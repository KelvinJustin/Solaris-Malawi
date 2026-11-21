import { registerAs } from '@nestjs/config';

/**
 * Fails at boot — not at first payment attempt — if required secrets are
 * missing, so a misconfigured deploy never silently falls through to an
 * unauthenticated webhook path in production.
 */
export default registerAs('nowpayments', () => {
  const apiKey = process.env.NOWPAYMENTS_API_KEY?.trim();
  const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET?.trim();
  const baseUrl = (
    process.env.NOWPAYMENTS_BASE_URL?.trim() ||
    'https://api.nowpayments.io/v1'
  ).replace(/\/+$/, '');
  const publicApiBaseUrl = process.env.PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, '');
  const cryptoFeeBps = Number(process.env.NOWPAYMENTS_FEE_BPS ?? 0);

  const isProd = process.env.NODE_ENV === 'production';

  if (
    !Number.isInteger(cryptoFeeBps) ||
    cryptoFeeBps < 0 ||
    cryptoFeeBps >= 10_000
  ) {
    throw new Error('NOWPAYMENTS_FEE_BPS must be an integer from 0 to 9999.');
  }

  if (isProd) {
    if (!apiKey) {
      throw new Error('NOWPAYMENTS_API_KEY is required in production.');
    }
    if (!ipnSecret) {
      throw new Error(
        'NOWPAYMENTS_IPN_SECRET is required in production — without it, ' +
          'incoming payment-status webhooks cannot be authenticated and MUST NOT be trusted.',
      );
    }
    if (!publicApiBaseUrl || !publicApiBaseUrl.startsWith('https://')) {
      throw new Error(
        'PUBLIC_API_BASE_URL must be a public HTTPS URL in production — ' +
          'it is embedded in every NOWPayments invoice as the IPN callback target.',
      );
    }
  }

  return {
    apiKey,
    ipnSecret,
    baseUrl,
    publicApiBaseUrl,
    cryptoFeeBps,
  };
});