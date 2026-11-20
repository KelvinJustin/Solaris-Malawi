import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { ProviderCallbacksController } from './provider-callbacks.controller.js';
import { ProviderCallbacksService } from './provider-callbacks.service.js';

@Module({
  imports: [DatabaseModule, LedgerModule],
  controllers: [ProviderCallbacksController],
  providers: [ProviderCallbacksService],
})
export class ProviderCallbacksModule {}