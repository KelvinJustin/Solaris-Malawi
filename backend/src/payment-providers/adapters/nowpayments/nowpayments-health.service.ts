import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { NowPaymentsApiClient } from './nowpayments-api.client.js';

const HEALTH_CHECK_INTERVAL_MS = 60_000;

@Injectable()
export class NowPaymentsHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NowPaymentsHealthService.name);
  private intervalHandle: NodeJS.Timeout | undefined;
  private isChecking = false;

  constructor(private readonly nowPaymentsApiClient: NowPaymentsApiClient) {}

  onModuleInit(): void {
    void this.checkApiStatus();
    this.intervalHandle = setInterval(() => {
      void this.checkApiStatus();
    }, HEALTH_CHECK_INTERVAL_MS);
    this.intervalHandle.unref?.();
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }
  }

  private async checkApiStatus(): Promise<void> {
    if (this.isChecking) {
      return;
    }
    this.isChecking = true;

    try {
      const { message } = await this.nowPaymentsApiClient.getApiStatus();
      if (message.trim().toUpperCase() === 'OK') {
        this.logger.log('NOWPayments API health check succeeded.');
      } else {
        this.logger.warn(`NOWPayments API health check returned: ${message}`);
      }
    } catch (error) {
      this.logger.error(
        'NOWPayments API health check failed.',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.isChecking = false;
    }
  }
}
