import { registerAs } from '@nestjs/config';

export default registerAs('fx', () => ({
  // open.er-api.com — free, no API key, MWK is supported. Republishes once
  // daily; see the provider's own doc comment for what that means for
  // "update every 15s".
  apiBaseUrl: (
    process.env.FX_RATE_API_BASE_URL?.trim() ||
    'https://open.er-api.com/v6/latest'
  ).replace(/\/+$/, ''),
  pollIntervalMs: Number(process.env.FX_RATE_POLL_INTERVAL_MS ?? 15_000),
}));