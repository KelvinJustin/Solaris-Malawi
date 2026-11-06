import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PaymentProvider } from '../generated/prisma/enums.js';
import { TestProviderAdapter } from './adapters/test-provider.adapter.js';
import {
  PAYMENT_PROVIDER_ADAPTERS,
  PaymentProviderRegistry,
} from './registry/payment-provider.registry.js';

@Module({
  providers: [
    // Create the simulator adapter with its required dependencies.
    {
      provide: TestProviderAdapter,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new TestProviderAdapter(
          configService,
          PaymentProvider.TEST,
        ),
    },

    // Supply the registered adapters to the provider registry.
    {
      provide: PAYMENT_PROVIDER_ADAPTERS,
      inject: [TestProviderAdapter],
      useFactory: (testProvider: TestProviderAdapter) => [
        testProvider,
      ],
    },

    PaymentProviderRegistry,
  ],
  exports: [PaymentProviderRegistry],
})
export class PaymentProvidersModule { }