export function formatCryptoAmount(amount: string): string {
  const [whole, fraction] = amount.split('.');
  const normalizedFraction = fraction?.replace(/0+$/, '');
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
}

// NOT exhaustive. Verify new entries against NOWPayments' own
// GET /v1/currencies / GET /v1/full-currencies response before relying on
// this for an asset you haven't seen before — this table is a convenience
// for known tickers, not a source of truth.
const KNOWN_TICKERS: Record<string, { asset: string; network: string | null }> =
  {
    usdttrc20: { asset: 'USDT', network: 'TRC20' },
    usdterc20: { asset: 'USDT', network: 'ERC20' },
    usdtbep20: { asset: 'USDT', network: 'BEP20' },
    usdcerc20: { asset: 'USDC', network: 'ERC20' },
    usdcbep20: { asset: 'USDC', network: 'BEP20' },
    btc: { asset: 'BTC', network: null },
    eth: { asset: 'ETH', network: null },
    bnb: { asset: 'BNB', network: null },
    trx: { asset: 'TRX', network: null },
    ltc: { asset: 'LTC', network: null },
    doge: { asset: 'DOGE', network: null },
  };

export function resolveNowPaymentsCurrency(
  asset: string,
  network: string | null,
): string | undefined {
  const normalizedAsset = asset.trim().toUpperCase();
  const normalizedNetwork = network?.trim().toUpperCase() || null;

  return Object.entries(KNOWN_TICKERS).find(
    ([, pair]) =>
      pair.asset === normalizedAsset && pair.network === normalizedNetwork,
  )?.[0];
}
