import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import type { Request } from 'express';

import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt-auth.guard.js';
import { AdminService } from './admin.service.js';
import { AdminRole } from '../generated/prisma/enums.js';
import { AdminRoles } from '../admin-auth/admin-roles.decorator.js';
import { AdminRolesGuard } from '../admin-auth/admin-roles.guard.js';

@Controller('admin')
@UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
  ) { }

  // Returns merchant applications awaiting compliance review.
  // Only authenticated admins can access this endpoint.
  @Get('merchant-applications')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMPLIANCE)
  findMerchantApplications(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    // Forward parsed pagination parameters to the admin service to retrieve paged merchant applications.
    return this.adminService.findMerchantApplications(
      Number(page),
      Number(limit),
    );
  }

  @Get('merchant-applications/:profileId')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMPLIANCE)
  findMerchantApplicationById(
    @Param('profileId') profileId: string,
  ) {
    // Delegate the lookup of a specific merchant application by its unique profile ID to the service layer.
    return this.adminService.findMerchantApplicationById(
      profileId,
    );
  }

  @Post('merchant-applications/:profileId/start-review')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMPLIANCE)
  startMerchantApplicationReview(
    @Param('profileId') profileId: string,
    @Req() request: Request,
  ) {
    // Extract the authenticated admin's details from the request object populated by the JWT guard.
    const admin = request.user as {
      adminId: string;
      role: AdminRole;
    };

    // Invoke the service method to transition the application state into review using the verified admin ID.
    return this.adminService.startMerchantApplicationReview(
      profileId,
      admin.adminId,
    );
  }

  // Approves a merchant application after validating its documents.
  // Only SUPER_ADMIN and COMPLIANCE admins may approve applications.
  @Post('merchant-applications/:profileId/approve')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMPLIANCE)
  approveMerchantApplication(
    @Param('profileId') profileId: string,
    @Req() request: Request,
  ) {
    // The authenticated admin comes from the JWT guard.
    // Never accept adminId from the request body.
    const admin = request.user as {
      adminId: string;
      role: AdminRole;
    };

    // Delegate the approval workflow and document validation checks to the admin service.
    return this.adminService.approveMerchantApplication(
      profileId,
      admin.adminId,
    );
  }


  // Rejects a merchant application and records the reason.
  @Post('merchant-applications/:profileId/reject')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMPLIANCE)
  rejectMerchantApplication(
    @Param('profileId') profileId: string,
    @Req() request: Request,
    @Body('reason') reason: unknown,
  ) {
    if (typeof reason !== 'string') {
      throw new BadRequestException('A rejection reason must be a string.');
    }

    // Extract the authenticated admin identity from the request context.
    const admin = request.user as {
      adminId: string;
      role: AdminRole;
    };

    // Delegate the application rejection and audit logging logic to the service layer.
    return this.adminService.rejectMerchantApplication(
      profileId,
      admin.adminId,
      reason,
    );
  }


  @Get('merchant-applications/:profileId/documents/:documentId/preview')
  @UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.COMPLIANCE)
  previewMerchantDocument(
    @Param('profileId') profileId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.adminService.createDocumentPreviewUrl(
      profileId,
      documentId,
    );
  }


}
