import { Module } from '@nestjs/common';
import { MerchantsService } from './merchants.service.js';
import { MerchantsController } from './merchants.controller.js';
import { MerchantDocumentsService } from './merchant-documents.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [DatabaseModule, StorageModule],
  controllers: [MerchantsController],
  providers: [MerchantsService, MerchantDocumentsService],
})
export class MerchantsModule { }