// src/fx/fx-rate.provider.ts
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FxQuote {
  fromCurrency: 'MWK';
  toCurrency: string;
  rate: string;
  capturedAt: Date;
}

export const FX_RATE_PROVIDER = Symbol('FX_RATE_PROVIDER');

export interface FxRateProvider {
  getRate(toCurrency: string): Promise<FxQuote>;
}

interface CachedRate {
  rate: string;
  fetchedAt: Date;
  sourcePublishedAt: Date | null;
}

@Injectable()
export class LiveFxRateProvider
  implements FxRateProvider, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(LiveFxRateProvider.name);
  private readonly cache = new Map<string, CachedRate>();
  private readonly requestedCurrencies = new Set<string>();
  private intervalHandle: NodeJS.Timeout | undefined;

  // Coalesces concurrent callers into one in-flight fetch instead of each
  // starting its own — this is what was missing, and what turned "cache is
  // cold" into N parallel failing requests instead of one.
  private inFlightRefresh: Promise<void> | null = null;

  // Throttles repeated identical failure logs. Without this, a sustained
  // outage logs once per request/tick forever instead of once per state
  // change.
  private lastFailureLoggedAt: number | null = null;
  private readonly failureLogThrottleMs = 30_000;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const pollIntervalMs = this.configService.get<number>('fx.pollIntervalMs')!;
    void this.refresh();
    this.intervalHandle = setInterval(() => void this.refresh(), pollIntervalMs);
    this.intervalHandle.unref?.();
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }
  }

  async getRate(toCurrency: string): Promise<FxQuote> {
    const key = toCurrency.toLowerCase();
    let cached = this.cache.get(key);

    if (!cached) {
      this.requestedCurrencies.add(key);
      await this.refresh(); // shares the in-flight promise if one is already running
      cached = this.cache.get(key);
      if (!cached) {
        throw new ServiceUnavailableException(
          `No FX quote available yet for MWK->${toCurrency}.`,
        );
      }
    }

    return {
      fromCurrency: 'MWK',
      toCurrency: key,
      rate: cached.rate,
      capturedAt: cached.fetchedAt,
    };
  }

  /** Public entry point is always this — never call doRefresh() directly. */
  private refresh(): Promise<void> {
    if (!this.inFlightRefresh) {
      this.inFlightRefresh = this.doRefresh().finally(() => {
        this.inFlightRefresh = null;
      });
    }
    return this.inFlightRefresh;
  }

  private logFailureThrottled(message: string): void {
    const now = Date.now();
    if (
      this.lastFailureLoggedAt === null ||
      now - this.lastFailureLoggedAt > this.failureLogThrottleMs
    ) {
      this.logger.warn(message);
      this.lastFailureLoggedAt = now;
    }
  }

  private async doRefresh(): Promise<void> {
    const apiBaseUrl = this.configService.get<string>('fx.apiBaseUrl');

    if (!apiBaseUrl) {
      this.logFailureThrottled(
        'FX rate fetch skipped: fx.apiBaseUrl is not configured (is fx.config.ts registered in ConfigModule.forRoot({ load: [...] })?).',
      );
      return;
    }

    const url = `${apiBaseUrl}/MWK`;

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    } catch (error) {
      this.logFailureThrottled(`FX rate fetch failed (network error): ${(error as Error).message}`);
      return;
    }

    if (!response.ok) {
      this.logFailureThrottled(`FX rate fetch failed (HTTP ${response.status}).`);
      return;
    }

    let body: {
      rates?: Record<string, number>;
      time_last_update_utc?: string;
      result?: string;
    };

    try {
      body = await response.json();
    } catch {
      this.logFailureThrottled('FX rate fetch failed (invalid JSON response).');
      return;
    }

    if (body.result && body.result !== 'success') {
      this.logFailureThrottled(`FX rate provider reported a non-success result: ${JSON.stringify(body)}`);
      return;
    }

    if (!body.rates || Object.keys(body.rates).length === 0) {
      this.logFailureThrottled('FX rate response had no rates object.');
      return;
    }

    const fetchedAt = new Date();
    const sourcePublishedAt = body.time_last_update_utc
      ? new Date(body.time_last_update_utc)
      : null;

    const currenciesToUpdate = new Set<string>([
      ...this.cache.keys(),
      ...this.requestedCurrencies,
    ]);
    const configuredTarget = this.configService.get<string>('nowpayments.settlementPriceCurrency');
    if (configuredTarget) {
      currenciesToUpdate.add(configuredTarget.toLowerCase());
    }

    for (const currency of currenciesToUpdate) {
      const rate = body.rates[currency.toUpperCase()];
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
        this.logFailureThrottled(`FX rate response had no usable rate for ${currency}.`);
        continue;
      }
      this.cache.set(currency, { rate: String(rate), fetchedAt, sourcePublishedAt });
    }

    this.lastFailureLoggedAt = null; // next failure, if any, logs immediately — it's a new incident
    this.logger.debug(
      `FX rates refreshed (source last published ${sourcePublishedAt?.toISOString() ?? 'unknown'}).`,
    );
  }
}