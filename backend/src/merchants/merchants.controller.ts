import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { MerchantsService } from './merchants.service.js';
import { MerchantDocumentsService } from './merchant-documents.service.js';
import { RequestDocumentUploadDto } from './dto/request-document-upload.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';

@UseGuards(JwtAuthGuard)
@Controller('merchants')
export class MerchantsController {
  constructor(
    private readonly merchantsService: MerchantsService,
    private readonly merchantDocumentsService: MerchantDocumentsService,
  ) { }

  // ============================================================
  // PROFILE
  // ============================================================

  // GET /merchants/profile
  @Get('profile')
  getMyProfile(@CurrentUser('userId') merchantId: string) {
    return this.merchantsService.getMyProfile(merchantId);
  }

  // PATCH /merchants/profile
  @Patch('profile')
  updateProfile(
    @CurrentUser('userId') merchantId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.merchantsService.updateProfile(merchantId, dto);
  }

  // ============================================================
  // SUBMISSION
  // ============================================================

  // POST /merchants/profile/submit
  @Post('profile/submit')
  submitForReview(@CurrentUser('userId') merchantId: string) {
    return this.merchantsService.submitForReview(merchantId);
  }

  // ============================================================
  // DOCUMENTS
  // ============================================================

  // POST /merchants/documents/upload-url
  @Post('documents/upload-url')
  requestDocumentUpload(
    @CurrentUser('userId') merchantId: string,
    @Body() dto: RequestDocumentUploadDto,
  ) {
    return this.merchantDocumentsService.requestUpload(merchantId, dto);
  }

  // POST /merchants/documents/:uploadId/complete
  @Post('documents/:uploadId/complete')
  completeDocumentUpload(
    @CurrentUser('userId') merchantId: string,
    @Param('uploadId') uploadId: string,
  ) {
    return this.merchantDocumentsService.completeUpload(merchantId, uploadId);
  }

  // GET /merchants/documents
  @Get('documents')
  listDocuments(
    @CurrentUser('userId') merchantId: string,
  ) {
    return this.merchantDocumentsService.listDocuments(merchantId);
  }

}