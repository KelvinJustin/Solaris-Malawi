// payment-providers.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PaymentProvider } from '../generated/prisma/enums.js';
import { DatabaseModule } from '../database/database.module.js'; // adjust path/export name if different
import { DatabaseService } from '../database/database.service.js';
import { TestProviderAdapter } from './adapters/test-provider.adapter.js';
import { NowPaymentsApiClient } from './adapters/nowpayments/nowpayments-api.client.js';
import { NowPaymentsProviderAdapter } from './adapters/nowpayments/nowpayments-payment-provider.adapter.js';
import { NowPaymentsWebhookController } from './adapters/nowpayments/nowpayments-webhook.controller.js';
import { NowPaymentsWebhookService } from './adapters/nowpayments/nowpayments-webhook.service.js';
import { FX_RATE_PROVIDER, LiveFxRateProvider } from '../fx/fx-rate.provider.js';
import { LedgerModule } from '../ledger/ledger.module.js';

import {
  PAYMENT_PROVIDER_ADAPTERS,
  PaymentProviderRegistry,
} from './registry/payment-provider.registry.js';

@Module({
  imports: [DatabaseModule, LedgerModule],
  controllers: [NowPaymentsWebhookController],
  providers: [
    // Plain injectable — ConfigService is autowired, no factory needed.
    NowPaymentsApiClient,

    { provide: FX_RATE_PROVIDER, useClass: LiveFxRateProvider },

    NowPaymentsWebhookService,

    {
      provide: TestProviderAdapter,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new TestProviderAdapter(configService, PaymentProvider.TEST),
    },

    {
      provide: NowPaymentsProviderAdapter,
      inject: [NowPaymentsApiClient, ConfigService, DatabaseService, FX_RATE_PROVIDER],
      useFactory: (
        client: NowPaymentsApiClient,
        configService: ConfigService,
        databaseService: DatabaseService,
        fxRateProvider: unknown,
      ) =>
        new NowPaymentsProviderAdapter(
          client,
          configService,
          databaseService,
          fxRateProvider as any, // typed via FxRateProvider in the adapter's own constructor
          PaymentProvider.NOWPAYMENTS,
        ),
    },

    {
      provide: PAYMENT_PROVIDER_ADAPTERS,
      inject: [TestProviderAdapter, NowPaymentsProviderAdapter],
      useFactory: (
        testProvider: TestProviderAdapter,
        nowPaymentsProvider: NowPaymentsProviderAdapter,
      ) => [testProvider, nowPaymentsProvider],
    },

    PaymentProviderRegistry,
  ],
  exports: [PaymentProviderRegistry],
})
export class PaymentProvidersModule {}