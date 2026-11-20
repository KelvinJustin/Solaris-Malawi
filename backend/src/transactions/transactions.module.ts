
import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { PaymentProvidersModule } from '../payment-providers/payment-providers.module.js';

import { TransactionsController } from './transactions.controller.js';
import { CheckoutController } from './checkout.controller.js';
import { TransactionsService } from './transactions.service.js';
import { CheckoutTokenService } from './checkout-token.service.js';
import { ArcjetGuard } from '../arcjet/arcjet.guard.js';
import { LedgerModule } from '../ledger/ledger.module.js';

@Module({
  imports: [
    DatabaseModule,
    PaymentProvidersModule,
    LedgerModule,
  ],
  controllers: [
    TransactionsController,
    CheckoutController,
  ],
  providers: [
    TransactionsService,
    CheckoutTokenService,
    ArcjetGuard,
  ],
})
export class TransactionsModule {}
