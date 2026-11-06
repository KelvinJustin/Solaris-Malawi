import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { DatabaseService } from '../database/database.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';

import {
  AccountStatus,
  DocumentStatus,
  DocumentType,
  ProfileActorType,
} from '../generated/prisma/enums.js';

import { getDocumentRequirements } from './document-requirements.js';

@Injectable()
export class MerchantsService {
  constructor(
    private readonly databaseService: DatabaseService,
  ) { }

  // ============================================================
  // PROFILE
  // ============================================================

  /**
   * Retrieves the authenticated merchant's profile and documents.
   *
   * Registration is responsible for creating the profile.
   * A missing profile therefore indicates an inconsistent state.
   */
  async getMyProfile(merchantId: string) {
    const profile =
      await this.databaseService.merchantProfile.findUnique({
        where: { merchantId },
        include: {
          documents: true,
        },
      });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    return profile;
  }

  /**
   * Merchants may update their business details while preparing
   * their application or correcting a rejected application.
   *
   * Once submitted for review, the profile is locked against
   * merchant edits. Approval-related fields must never be
   * controlled by the merchant.
   */
  async updateProfile(
    merchantId: string,
    dto: UpdateProfileDto,
  ) {
    const profile =
      await this.databaseService.merchantProfile.findUnique({
        where: { merchantId },
      });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const editableStatuses: AccountStatus[] = [
      AccountStatus.PENDING_SUBMISSION,
      AccountStatus.REJECTED,
    ];

    if (!editableStatuses.includes(profile.accountStatus)) {
      throw new BadRequestException(
        `Profile cannot be updated from status: ${profile.accountStatus}. ` +
        'Updates are only allowed while preparing an application ' +
        'or correcting a rejected application.',
      );
    }

    return this.databaseService.merchantProfile.update({
      where: { merchantId },
      data: dto,
    });
  }

  // ============================================================
  // SUBMISSION
  // ============================================================

  /**
   * Submits a merchant profile for administrative review.
   *
   * Allowed transitions:
   *
   * PENDING_SUBMISSION -> SUBMITTED
   * REJECTED           -> SUBMITTED
   *
   * The profile status change and audit-history entry are
   * committed in one database transaction.
   */
  async submitForReview(merchantId: string) {
    const profile =
      await this.databaseService.merchantProfile.findUnique({
        where: { merchantId },
        include: {
          documents: true,
        },
      });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    // Only initial submissions and rejected applications can
    // enter the submission workflow.
    const submittableStatuses: AccountStatus[] = [
      AccountStatus.PENDING_SUBMISSION,
      AccountStatus.REJECTED,
    ];

    if (!submittableStatuses.includes(profile.accountStatus)) {
      throw new BadRequestException(
        `Cannot submit from status: ${profile.accountStatus}. ` +
        'Submission is only allowed from PENDING_SUBMISSION or REJECTED.',
      );
    }

    // Business type determines which documents are mandatory.
    if (!profile.businessType) {
      throw new BadRequestException(
        'Business type must be provided before submission.',
      );
    }

    // Reject missing or whitespace-only business names.
    if (!profile.businessName?.trim()) {
      throw new BadRequestException(
        'Business name must be provided before submission.',
      );
    }

    // A document cannot satisfy a requirement if it has been
    // rejected, explicitly expired, or passed its expiry date.
    //
    // Pending documents are accepted for submission because
    // their verification can take place during admin review.
    const now = new Date();

    
const uploadedTypes = profile.documents
  .filter(
    (doc) =>
      // Ignore documents that have been superseded by newer uploads.
      doc.supersededAt === null &&
      doc.supersededByDocumentId === null &&

      // Ignore rejected or expired documents.
      doc.status !== DocumentStatus.REJECTED &&
      doc.status !== DocumentStatus.EXPIRED &&

      // Ignore documents whose expiry date has passed.
      (!doc.expiresAt || doc.expiresAt > now),
  )
  .map((doc) => doc.type);


    // Use the shared document policy so submission validation
// agrees with the policy used by the rest of the application.
const { required } = getDocumentRequirements(profile.businessType);

    const missing = required.filter(
      (type: DocumentType) => !uploadedTypes.includes(type),
    );

    if (missing.length > 0) {
      throw new BadRequestException(
        'Cannot submit. The following required documents are ' +
        `missing, rejected, or expired: ${missing.join(', ')}.`,
      );
    }

    // Update the profile and create its audit entry atomically.
    //
    // If either operation fails, Prisma rolls back the
    // transaction so the profile cannot be submitted without
    // its corresponding review-history record.
    return this.databaseService.$transaction(async (tx) => {
      // Change the status only if it still matches the status
      // we validated before entering the transaction.
      const transition = await tx.merchantProfile.updateMany({
        where: {
          merchantId,
          accountStatus: profile.accountStatus,
        },
        data: {
          accountStatus: AccountStatus.SUBMITTED,
          submittedAt: new Date(),
          rejectionReason: null,
        },
      });

      // Zero updated rows means another request or process changed
      // the status before this request could claim the transition.
      if (transition.count !== 1) {
        throw new BadRequestException(
          'Profile status has changed. Refresh your profile and try again.',
        );
      }

      // Retrieve the updated profile because updateMany returns
      // a count, not the updated record.
      const updatedProfile = await tx.merchantProfile.findUnique({
        where: { merchantId },
      });

      if (!updatedProfile) {
        throw new NotFoundException('Profile not found');
      }

      // Record the successful transition in the same transaction.
      await tx.merchantReviewHistory.create({
        data: {
          profileId: profile.id,
          fromStatus: profile.accountStatus,
          toStatus: AccountStatus.SUBMITTED,
          actorType: ProfileActorType.MERCHANT,
          actorId: merchantId,
        },
      });

      return updatedProfile;
    });
  }
}