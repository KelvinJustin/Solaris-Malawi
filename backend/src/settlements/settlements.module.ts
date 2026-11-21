import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../auth/admin-auth/admin-auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { AdminRolesGuard } from '../auth/admin-auth/admin-roles.guard.js';
import { SettlementController } from './settlement.controller.js';
import { SettlementService } from './settlement.service.js';

@Module({
  imports: [DatabaseModule, LedgerModule, AdminAuthModule],
  controllers: [SettlementController],
  providers: [SettlementService, AdminRolesGuard],
  exports: [SettlementService],
})
export class SettlementsModule {}
