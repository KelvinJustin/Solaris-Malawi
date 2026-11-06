
import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { PaymentProvidersModule } from '../payment-providers/payment-providers.module.js';

import { TransactionsController } from './transactions.controller.js';
import { CheckoutController } from './checkout.controller.js';
import { TransactionsService } from './transactions.service.js';
import { CheckoutTokenService } from './checkout-token.service.js';

@Module({
  imports: [
    DatabaseModule,
    PaymentProvidersModule,
  ],
  controllers: [
    TransactionsController,
    CheckoutController,
  ],
  providers: [
    TransactionsService,
    CheckoutTokenService,
  ],
})
export class TransactionsModule {}
