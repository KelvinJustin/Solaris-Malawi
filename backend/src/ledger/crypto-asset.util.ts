export interface ParsedCryptoAsset {
  asset: string;
  network: string | null;
}

// NOT exhaustive. Verify new entries against NOWPayments' own
// GET /v1/currencies / GET /v1/full-currencies response before relying on
// this for an asset you haven't seen before — this table is a convenience
// for known tickers, not a source of truth.
const KNOWN_TICKERS: Record<string, ParsedCryptoAsset> = {
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

export function parseNowPaymentsCurrency(payCurrency: string): ParsedCryptoAsset {
  const key = payCurrency.toLowerCase();
  const known = KNOWN_TICKERS[key];
  if (known) {
    return known;
  }

  // Unknown ticker: don't guess at a network split. Log loudly and fall
  // back to treating the whole ticker as the asset with no network — this
  // is correct in the sense that it won't collide with a known asset's
  // balance, but it means that asset's dashboard display will look odd
  // until this table is updated.
  return { asset: payCurrency.toUpperCase(), network: null };
}