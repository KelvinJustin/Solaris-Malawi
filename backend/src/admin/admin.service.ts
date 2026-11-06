import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';

import { DatabaseService } from '../database/database.service.js';
import { R2StorageService } from '../storage/r2-storage.service.js';
import {
  AccountStatus,
  DocumentStatus,
  ProfileActorType,
} from '../generated/prisma/enums.js';

import { getDocumentRequirements } from '../merchants/document-requirements.js';

@Injectable()
export class AdminService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly r2StorageService: R2StorageService,
  ) { }


  async findMerchantApplications(page = 1, limit = 20) {
    // Reject invalid pagination values instead of silently accepting them.
    if (
      !Number.isInteger(page) ||
      !Number.isInteger(limit) ||
      page < 1 ||
      limit < 1 ||
      limit > 100
    ) {
      throw new BadRequestException(
        'Page must be a positive integer and limit must be between 1 and 100.',
      );
    }

    const where = {
      accountStatus: {
        in: [
          AccountStatus.SUBMITTED,
          AccountStatus.UNDER_REVIEW,
        ],
      },
    };

    // Fetch the requested page and total count concurrently.
    const [applications, total] = await Promise.all([
      this.databaseService.merchantProfile.findMany({
        where,
        select: {
          id: true,
          businessName: true,
          businessType: true,
          accountStatus: true,
          submittedAt: true,
          createdAt: true,
          merchant: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          _count: {
            select: {
              documents: true,
            },
          },
        },
        orderBy: [
          { submittedAt: 'asc' },
          { id: 'asc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),

      this.databaseService.merchantProfile.count({ where }),
    ]);

    // Return the fetched applications along with pagination metadata.
    return {
      data: applications,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }


  async findMerchantApplicationById(profileId: string) {
    // Search for one profile using its unique ID.
    const application =
      await this.databaseService.merchantProfile.findUnique({
        where: {
          id: profileId,
        },
        include: {
          merchant: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          documents: {
            select: {
              id: true,
              type: true,
              status: true,
              mimeType: true,
              fileSizeBytes: true,
              rejectionNote: true,
              reviewedAt: true,
              expiresAt: true,
              uploadedAt: true,
              supersededAt: true,
              supersededByDocumentId: true,
            },
          },
          reviewHistory: {
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
      });

    // A missing profile should produce HTTP 404.
    if (!application) {
      throw new NotFoundException(
        'Merchant application not found.',
      );
    }

    // Return the full application details including related entities.
    return application;
  }

  async startMerchantApplicationReview(
    profileId: string,
    adminId: string,
  ) {
    // Perform all status transition checks and database mutations atomically inside a transaction.
    return this.databaseService.$transaction(async (tx) => {
      // Find the application we intend to start reviewing.
      const profile = await tx.merchantProfile.findUnique({
        where: { id: profileId },
        select: {
          id: true,
          accountStatus: true,
        },
      });

      // Throw a 404 error if the merchant profile does not exist.
      if (!profile) {
        throw new NotFoundException(
          'Merchant application not found.',
        );
      }

      // Only submitted applications can enter review.
      if (profile.accountStatus !== AccountStatus.SUBMITTED) {
        throw new ConflictException(
          'Only submitted applications can be moved into review.',
        );
      }

      // Use a conditional update to protect against concurrent reviewers.
      const updated = await tx.merchantProfile.updateMany({
        where: {
          id: profileId,
          accountStatus: AccountStatus.SUBMITTED,
        },
        data: {
          accountStatus: AccountStatus.UNDER_REVIEW,
        },
      });

      // Another request may have changed the status after our read.
      if (updated.count !== 1) {
        throw new ConflictException(
          'The application status changed. Refresh and try again.',
        );
      }

      // Record who made the status change in the same transaction.
      await tx.merchantReviewHistory.create({
        data: {
          profileId,
          fromStatus: AccountStatus.SUBMITTED,
          toStatus: AccountStatus.UNDER_REVIEW,
          actorType: ProfileActorType.ADMIN,
          actorId: adminId,
          note: 'Application review started.',
        },
      });

      // Return a success response confirming the updated status.
      return {
        profileId,
        accountStatus: AccountStatus.UNDER_REVIEW,
        message: 'Merchant application review started.',
      };
    });
  }


  /**
   * Approves a merchant application only when its documents
   * satisfy the configured document requirements.
   */
  async approveMerchantApplication(
    profileId: string,
    adminId: string,
  ) {
    // Wrap all validation and database updates in a single transaction for atomicity.
    return this.databaseService.$transaction(async (tx) => {
      // Load the profile and all documents needed for validation.
      const profile = await tx.merchantProfile.findUnique({
        where: { id: profileId },
        select: {
          id: true,
          businessType: true,
          accountStatus: true,
          documents: {
            select: {
              type: true,
              status: true,
              expiresAt: true,
              supersededAt: true,
              supersededByDocumentId: true,
            },
          },
        },
      });

      // Throw a 404 error if the merchant application does not exist.
      if (!profile) {
        throw new NotFoundException(
          'Merchant application not found.',
        );
      }

      // Approval is only allowed after an admin starts reviewing.
      if (profile.accountStatus !== AccountStatus.UNDER_REVIEW) {
        throw new ConflictException(
          'Only applications under review can be approved.',
        );
      }

      // A business type is necessary to determine its requirements.
      if (!profile.businessType) {
        throw new BadRequestException(
          'The merchant business type has not been provided.',
        );
      }

      // Retrieve the document requirements specific to the merchant's business type.
      const requirements = getDocumentRequirements(profile.businessType);

      // Cache the current timestamp to consistently evaluate document expiration.
      const now = new Date();

      // Required documents must exist, be approved, and not be expired.


      const missingOrInvalidRequired = requirements.required.filter(
        (requiredType) => {
          // Get every uploaded document of this required type.
          const documents = profile.documents.filter(
            (document) =>
              document.type === requiredType &&
              document.supersededAt === null &&
              document.supersededByDocumentId === null,
          );

          // At least one must be approved and not expired.
          const hasValidDocument = documents.some(
            (document) =>
              document.status === DocumentStatus.APPROVED &&
              (document.expiresAt === null ||
                document.expiresAt > now),
          );

          return !hasValidDocument;
        },
      );


      // Throw a bad request exception if any required documents are missing or invalid.
      if (missingOrInvalidRequired.length > 0) {
        throw new BadRequestException({
          message: 'Required documents are missing or not valid.',
          documents: missingOrInvalidRequired,
        });
      }


      // Documents are optional to submit, but every uploaded
      // document must be approved and unexpired at approval time.
      // A rejected upload is acceptable only when a valid replacement
      // of the same document type exists.

      const invalidDocuments = profile.documents.filter((document) => {
        // Superseded documents stay in the audit history,
        // but they do not count as current uploads.
        if (
          document.supersededAt !== null ||
          document.supersededByDocumentId !== null
        ) {
          return false;
        }

        // Every current upload must be approved.
        // A pending, rejected, or expired-status document blocks approval.
        if (document.status !== DocumentStatus.APPROVED) {
          return true;
        }

        // An approved document with an expiry date must still be valid.
        return (
          document.expiresAt !== null &&
          document.expiresAt <= now
        );
      });


      // Throw a bad request exception if any uploaded documents require attention.
      if (invalidDocuments.length > 0) {
        throw new BadRequestException({
          message:
            'Uploaded documents need attention before approval.',
          documents: invalidDocuments.map((document) => ({
            type: document.type,
            status: document.status,
          })),
        });
      }

      // Conditionally update to protect against concurrent requests.
      const updated = await tx.merchantProfile.updateMany({
        where: {
          id: profileId,
          accountStatus: AccountStatus.UNDER_REVIEW,
        },
        data: {
          accountStatus: AccountStatus.APPROVED,
          approvedAt: now,
          approvedById: adminId,
          rejectionReason: null,
        },
      });

      // Ensure the conditional update successfully affected exactly one record.
      if (updated.count !== 1) {
        throw new ConflictException(
          'The application status changed. Refresh and try again.',
        );
      }

      // Audit history and status change must commit together.
      await tx.merchantReviewHistory.create({
        data: {
          profileId,
          fromStatus: AccountStatus.UNDER_REVIEW,
          toStatus: AccountStatus.APPROVED,
          actorType: ProfileActorType.ADMIN,
          actorId: adminId,
          note: 'Merchant application approved.',
        },
      });

      // Return a success payload indicating the application has been approved.
      return {
        profileId,
        accountStatus: AccountStatus.APPROVED,
        message: 'Merchant application approved.',
      };
    });
  }


  /**
   * Rejects a merchant application that is currently under review.
   *
   * The status update, rejection reason, and audit-history entry
   * are saved in one transaction. If any operation fails, none
   * of those changes should be committed.
   */
  async rejectMerchantApplication(
    profileId: string,
    adminId: string,
    reason: string,
  ) {
    // Normalize whitespace so a reason containing only spaces
    // cannot pass validation.
    const rejectionReason = reason.trim();

    if (!rejectionReason) {
      throw new BadRequestException(
        'A rejection reason is required.',
      );
    }

    return this.databaseService.$transaction(async (tx) => {
      // Load the current status before attempting the transition.
      const profile = await tx.merchantProfile.findUnique({
        where: { id: profileId },
        select: {
          id: true,
          accountStatus: true,
        },
      });

      if (!profile) {
        throw new NotFoundException(
          'Merchant application not found.',
        );
      }

      // Rejection is only allowed after a review has started.
      if (profile.accountStatus !== AccountStatus.UNDER_REVIEW) {
        throw new ConflictException(
          'Only applications under review can be rejected.',
        );
      }

      // Persist the decision only if the application is still under review.
      const updated = await tx.merchantProfile.updateMany({
        where: {
          id: profileId,
          accountStatus: AccountStatus.UNDER_REVIEW,
        },
        data: {
          accountStatus: AccountStatus.REJECTED,
          rejectionReason,
        },
      });

      if (updated.count !== 1) {
        throw new ConflictException(
          'The application status changed. Refresh and try again.',
        );
      }

      // Record who made the decision and the status transition.
      await tx.merchantReviewHistory.create({
        data: {
          profileId,
          fromStatus: AccountStatus.UNDER_REVIEW,
          toStatus: AccountStatus.REJECTED,
          note: rejectionReason,
          actorType: ProfileActorType.ADMIN,
          actorId: adminId,
        },
      });

      return {
        profileId,
        accountStatus: AccountStatus.REJECTED,
        rejectionReason,
        message: 'Merchant application rejected.',
      };
    });
  }


  async createDocumentPreviewUrl(
    profileId: string,
    documentId: string,
  ) {
    const document = await this.databaseService.merchantDocument.findFirst({
      where: {
        id: documentId,
        profileId,
      },
      select: {
        id: true,
        fileKey: true,
        type: true,
        status: true,
        mimeType: true,
        fileSizeBytes: true,
      },
    });

    if (!document) {
      throw new NotFoundException('Merchant document not found');
    }

    const previewUrl = await this.r2StorageService.createDownloadUrl(
      document.fileKey,
      300,
    );

    return {
      document: {
        id: document.id,
        type: document.type,
        status: document.status,
        mimeType: document.mimeType,
        fileSizeBytes: document.fileSizeBytes,
      },
      previewUrl,
      expiresInSeconds: 300,
    };
  }


}
