// payment-providers.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PaymentProvider } from '../generated/prisma/enums.js';
import { DatabaseModule } from '../database/database.module.js';
import { DatabaseService } from '../database/database.service.js';
import { TestProviderAdapter } from './adapters/test-provider.adapter.js';
import { NowPaymentsApiClient } from './adapters/nowpayments/nowpayments-api.client.js';
import { NowPaymentsHealthService } from './adapters/nowpayments/nowpayments-health.service.js';
import { NowPaymentsProviderAdapter } from './adapters/nowpayments/nowpayments-payment-provider.adapter.js';

import {
  PAYMENT_PROVIDER_ADAPTERS,
  PaymentProviderRegistry,
} from './registry/payment-provider.registry.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    NowPaymentsApiClient,
    NowPaymentsHealthService,

    {
      provide: TestProviderAdapter,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new TestProviderAdapter(configService, PaymentProvider.TEST),
    },

    {
      provide: NowPaymentsProviderAdapter,
      inject: [NowPaymentsApiClient, ConfigService, DatabaseService],
      useFactory: (
        client: NowPaymentsApiClient,
        configService: ConfigService,
        databaseService: DatabaseService,
      ) =>
        new NowPaymentsProviderAdapter(
          client,
          configService,
          databaseService,
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
  exports: [PaymentProviderRegistry, NowPaymentsApiClient],
})
export class PaymentProvidersModule {}
