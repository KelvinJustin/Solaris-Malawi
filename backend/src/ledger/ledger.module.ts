import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { FeePolicyService } from './fee-policy.service.js';
import { LedgerPostingService } from './ledger-posting.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [FeePolicyService, LedgerPostingService],
  exports: [FeePolicyService, LedgerPostingService],
})
export class LedgerModule {}
