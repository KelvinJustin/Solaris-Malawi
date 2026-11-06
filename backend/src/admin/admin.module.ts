import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { StorageModule } from '../storage/storage.module.js'

import { AdminService } from './admin.service.js';
import { AdminController } from './admin.controller.js';

import { AdminRolesGuard } from '../admin-auth/admin-roles.guard.js';

@Module({
  imports: [DatabaseModule, AdminAuthModule, StorageModule],
  controllers: [AdminController],
  providers: [AdminService, AdminRolesGuard],
})
export class AdminModule { }
