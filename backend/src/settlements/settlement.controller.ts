import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminJwtAuthGuard } from '../auth/admin-auth/admin-jwt-auth.guard.js';
import { AdminRolesGuard } from '../auth/admin-auth/admin-roles.guard.js';
import { AdminRoles } from '../auth/admin-auth/admin-roles.decorator.js';
import { AdminRole } from '../generated/prisma/enums.js';
import { SettlementService } from './settlement.service.js';
import type {
  NormalizedBankStatement,
  NormalizedProviderSettlementReport,
} from './settlement-normalized.types.js';
import { AllocateSettlementBankCreditDto } from './settlement.dto.js';

@Controller('admin/settlements')
@UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
export class SettlementController {
  constructor(private readonly settlementService: SettlementService) {}

  @Post('provider-imports/normalized')
  @AdminRoles(AdminRole.OPERATIONS)
  importProviderSettlement(
    @Body() report: NormalizedProviderSettlementReport,
    @Req() request: Request,
  ) {
    const admin = request.user as { adminId: string };
    return this.settlementService.importProviderSettlement(
      report,
      admin.adminId,
    );
  }

  @Post('bank-statements/normalized')
  @AdminRoles(AdminRole.OPERATIONS)
  importBankStatement(
    @Body() statement: NormalizedBankStatement,
    @Req() request: Request,
  ) {
    const admin = request.user as { adminId: string };
    return this.settlementService.importBankStatement(statement, admin.adminId);
  }

  @Post(':batchId/reconcile')
  @AdminRoles(AdminRole.OPERATIONS)
  reconcileBatch(@Param('batchId') batchId: string, @Req() request: Request) {
    const admin = request.user as { adminId: string };
    return this.settlementService.reconcileBatch(batchId, admin.adminId);
  }

  @Post('allocations')
  @AdminRoles(AdminRole.OPERATIONS)
  allocateBankCredit(
    @Body() dto: AllocateSettlementBankCreditDto,
    @Req() request: Request,
  ) {
    const admin = request.user as { adminId: string };
    return this.settlementService.allocateBankCredit(
      dto.batchId,
      dto.bankStatementLineId,
      BigInt(dto.amountTambala),
      dto.idempotencyKey,
      admin.adminId,
    );
  }

  @Post(':batchId/approve')
  @AdminRoles(AdminRole.SUPER_ADMIN)
  approveBatch(@Param('batchId') batchId: string, @Req() request: Request) {
    const admin = request.user as { adminId: string };
    return this.settlementService.approveBatch(batchId, admin.adminId);
  }

  @Post(':batchId/post')
  @AdminRoles(AdminRole.SUPER_ADMIN)
  postBatch(@Param('batchId') batchId: string, @Req() request: Request) {
    const admin = request.user as { adminId: string };
    return this.settlementService.postBatch(batchId, admin.adminId);
  }
}
