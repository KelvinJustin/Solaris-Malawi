import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { ProviderCallbacksController } from './provider-callbacks.controller.js';
import { ProviderCallbacksService } from './provider-callbacks.service.js';
import { CryptoLedgerPostingService } from '../ledger/crypto-ledger-posting.service.js';
import { PaymentProvidersModule } from '../payment-providers/payment-providers.module.js';
import { NowPaymentsReconciliationService } from './nowpayments-reconciliation.service.js';

@Module({
  imports: [DatabaseModule, LedgerModule, PaymentProvidersModule],
  controllers: [ProviderCallbacksController],
  providers: [
    ProviderCallbacksService,
    CryptoLedgerPostingService,
    NowPaymentsReconciliationService,
  ],
})
export class ProviderCallbacksModule {}