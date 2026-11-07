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

  /**
   * Returns the authenticated merchant's profile and related KYC documents.
   */
  // GET /merchants/profile
  @Get('profile')
  getMyProfile(@CurrentUser('userId') merchantId: string) {
    return this.merchantsService.getMyProfile(merchantId);
  }

  /**
   * Updates editable profile fields while the application is in a mutable state.
   */
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

  /**
   * Submits the merchant profile to the admin review workflow.
   */
  // POST /merchants/profile/submit
  @Post('profile/submit')
  submitForReview(@CurrentUser('userId') merchantId: string) {
    return this.merchantsService.submitForReview(merchantId);
  }

  // ============================================================
  // DOCUMENTS
  // ============================================================

  /**
   * Requests a signed upload URL for a document needed by the merchant profile.
   */
  // POST /merchants/documents/upload-url
  @Post('documents/upload-url')
  requestDocumentUpload(
    @CurrentUser('userId') merchantId: string,
    @Body() dto: RequestDocumentUploadDto,
  ) {
    return this.merchantDocumentsService.requestUpload(merchantId, dto);
  }

  /**
   * Finalizes an upload after the file metadata and content signature are checked.
   */
  // POST /merchants/documents/:uploadId/complete
  @Post('documents/:uploadId/complete')
  completeDocumentUpload(
    @CurrentUser('userId') merchantId: string,
    @Param('uploadId') uploadId: string,
  ) {
    return this.merchantDocumentsService.completeUpload(merchantId, uploadId);
  }

  /**
   * Lists the merchant's uploaded documents and their current assessment state.
   */
  // GET /merchants/documents
  @Get('documents')
  listDocuments(
    @CurrentUser('userId') merchantId: string,
  ) {
    return this.merchantDocumentsService.listDocuments(merchantId);
  }

}