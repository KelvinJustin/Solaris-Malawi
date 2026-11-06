import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';

import { AdminService } from './admin.service.js';
import { DatabaseService } from '../database/database.service.js';
import { R2StorageService } from '../storage/r2-storage.service.js';

import {
  AccountStatus,
  BusinessType,
  DocumentStatus,
  ProfileActorType,
} from '../generated/prisma/enums.js';

// Define the test suite for AdminService functionality.
describe('AdminService', () => {
  let service: AdminService;

  // Mock only the Prisma operations this test needs.
  const databaseService = {
    merchantProfile: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const transactionClient = {
    merchantProfile: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    merchantReviewHistory: {
      create: vi.fn(),
    },
  };

  // Creates a document fixture with the nullable fields returned by Prisma.
  const makeDocument = (
    type: string,
    status: DocumentStatus,
    expiresAt: Date | null = null,
    supersededAt: Date | null = null,
    supersededByDocumentId: string | null = null,
  ) => ({
    type,
    status,
    expiresAt,
    supersededAt,
    supersededByDocumentId,
  });

  // Set up the testing module and initialize dependencies before each test case.
  beforeEach(async () => {
    vi.clearAllMocks();

    // Simulate Prisma's transaction callback for service unit tests.
    databaseService.$transaction.mockImplementation(
      async (callback) => callback(transactionClient),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: DatabaseService,
          useValue: databaseService,
        },
        {
          provide: R2StorageService,
          useValue: {
            createUploadUrl: vi.fn(),
            createDownloadUrl: vi.fn(),
            createPreviewUrl: vi.fn(),
            getObjectMetadata: vi.fn(),
            deleteObject: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  // Test suite for finding merchant application details by unique identifier.
  describe('findMerchantApplicationById', () => {
    // Verify that a valid application profile is successfully retrieved along with its relations.
    it('returns an application when the profile exists', async () => {
      const application = {
        id: 'profile-123',
        businessName: 'Test Business',
        merchant: { id: 'merchant-123' },
        documents: [],
        reviewHistory: [],
      };

      databaseService.merchantProfile.findUnique.mockResolvedValue(
        application,
      );

      const result =
        await service.findMerchantApplicationById('profile-123');

      expect(result).toEqual(application);
      expect(databaseService.merchantProfile.findUnique).toHaveBeenCalledWith({
        where: { id: 'profile-123' },
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
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    });

    // Verify that searching for a non-existent profile throws a NotFoundException.
    it('throws NotFoundException when the profile does not exist', async () => {
      databaseService.merchantProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.findMerchantApplicationById('missing-profile'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // Test suite for initiating the review process on a merchant application.
  describe('startMerchantApplicationReview', () => {
    // Verify that a submitted application transitions to under review and logs the admin action.
    it('moves a submitted application into review and records the admin action', async () => {
      transactionClient.merchantProfile.findUnique.mockResolvedValue({
        id: 'profile-123',
        accountStatus: AccountStatus.SUBMITTED,
      });

      transactionClient.merchantProfile.updateMany.mockResolvedValue({
        count: 1,
      });

      transactionClient.merchantReviewHistory.create.mockResolvedValue({
        id: 'history-123',
      });

      const result = await service.startMerchantApplicationReview(
        'profile-123',
        'admin-123',
      );

      expect(transactionClient.merchantProfile.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'profile-123',
          accountStatus: AccountStatus.SUBMITTED,
        },
        data: {
          accountStatus: AccountStatus.UNDER_REVIEW,
        },
      });

      expect(
        transactionClient.merchantReviewHistory.create,
      ).toHaveBeenCalledWith({
        data: {
          profileId: 'profile-123',
          fromStatus: AccountStatus.SUBMITTED,
          toStatus: AccountStatus.UNDER_REVIEW,
          actorType: ProfileActorType.ADMIN,
          actorId: 'admin-123',
          note: 'Application review started.',
        },
      });

      expect(result).toEqual({
        profileId: 'profile-123',
        accountStatus: AccountStatus.UNDER_REVIEW,
        message: 'Merchant application review started.',
      });
    });

    // Verify that attempting to review a missing profile throws a NotFoundException.
    it('throws NotFoundException when the application does not exist', async () => {
      transactionClient.merchantProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.startMerchantApplicationReview(
          'missing-profile',
          'admin-123',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(transactionClient.merchantProfile.updateMany).not.toHaveBeenCalled();
      expect(
        transactionClient.merchantReviewHistory.create,
      ).not.toHaveBeenCalled();
    });

    // Verify that reviewing an application that is not in the submitted state throws a ConflictException.
    it('throws ConflictException when the application is not submitted', async () => {
      transactionClient.merchantProfile.findUnique.mockResolvedValue({
        id: 'profile-123',
        accountStatus: AccountStatus.UNDER_REVIEW,
      });

      await expect(
        service.startMerchantApplicationReview(
          'profile-123',
          'admin-123',
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(transactionClient.merchantProfile.updateMany).not.toHaveBeenCalled();
      expect(
        transactionClient.merchantReviewHistory.create,
      ).not.toHaveBeenCalled();
    });

    // Verify that race conditions resulting in concurrent status modifications throw a ConflictException.
    it('throws ConflictException if another request changes the status first', async () => {
      transactionClient.merchantProfile.findUnique.mockResolvedValue({
        id: 'profile-123',
        accountStatus: AccountStatus.SUBMITTED,
      });

      // Simulate a competing request winning the conditional update.
      transactionClient.merchantProfile.updateMany.mockResolvedValue({
        count: 0,
      });

      await expect(
        service.startMerchantApplicationReview(
          'profile-123',
          'admin-123',
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(
        transactionClient.merchantReviewHistory.create,
      ).not.toHaveBeenCalled();
    });

    // Verify that any error during the audit history write propagates correctly and rolls back the transaction.
    it('propagates an audit-history write failure', async () => {
      transactionClient.merchantProfile.findUnique.mockResolvedValue({
        id: 'profile-123',
        accountStatus: AccountStatus.SUBMITTED,
      });

      transactionClient.merchantProfile.updateMany.mockResolvedValue({
        count: 1,
      });

      transactionClient.merchantReviewHistory.create.mockRejectedValue(
        new Error('Audit write failed'),
      );

      await expect(
        service.startMerchantApplicationReview(
          'profile-123',
          'admin-123',
        ),
      ).rejects.toThrow('Audit write failed');
    });
  });

  // Test suite for approving merchant applications.
  describe('approveMerchantApplication', () => {
    const validProfile = {
      id: 'profile-123',
      businessType: BusinessType.INDIVIDUAL,
      accountStatus: AccountStatus.UNDER_REVIEW,
      documents: [
        makeDocument('NATIONAL_ID_FRONT', DocumentStatus.APPROVED),
        makeDocument('NATIONAL_ID_BACK', DocumentStatus.APPROVED),
      ],
    };

    // Configure common successful mock responses before each approval test.
    beforeEach(() => {
      transactionClient.merchantProfile.findUnique.mockResolvedValue(
        validProfile,
      );

      transactionClient.merchantProfile.updateMany.mockResolvedValue({
        count: 1,
      });

      transactionClient.merchantReviewHistory.create.mockResolvedValue({
        id: 'history-approval-123',
      });
    });

    // Verify successful approval when all required documents are validated.
    it('approves an application when required documents are valid', async () => {
      const result = await service.approveMerchantApplication(
        'profile-123',
        'admin-123',
      );

      expect(result).toEqual({
        profileId: 'profile-123',
        accountStatus: AccountStatus.APPROVED,
        message: 'Merchant application approved.',
      });

      expect(
        transactionClient.merchantProfile.updateMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'profile-123',
            accountStatus: AccountStatus.UNDER_REVIEW,
          },
          data: expect.objectContaining({
            accountStatus: AccountStatus.APPROVED,
            approvedById: 'admin-123',
            rejectionReason: null,
          }),
        }),
      );
    });

    // Verify that a rejected document is ignored if a valid replacement document exists.
    it('accepts a valid replacement when the rejected upload is superseded', async () => {
      transactionClient.merchantProfile.findUnique.mockResolvedValue({
        ...validProfile,
        documents: [
          makeDocument(
            'NATIONAL_ID_FRONT',
            DocumentStatus.REJECTED,
            null,
            new Date(),
            'replacement-document-123',
          ),
          makeDocument('NATIONAL_ID_FRONT', DocumentStatus.APPROVED),
          makeDocument('NATIONAL_ID_BACK', DocumentStatus.APPROVED),
        ],
      });

      await expect(
        service.approveMerchantApplication('profile-123', 'admin-123'),
      ).resolves.toMatchObject({
        accountStatus: AccountStatus.APPROVED,
      });
    });

    // Verify that approval is blocked if any required document type lacks a valid submission.
    it('rejects approval when a required type has no valid document', async () => {
      transactionClient.merchantProfile.findUnique.mockResolvedValue({
        ...validProfile,
        documents: [
          makeDocument('NATIONAL_ID_FRONT', DocumentStatus.APPROVED),
          makeDocument('NATIONAL_ID_BACK', DocumentStatus.REJECTED),
        ],
      });

      await expect(
        service.approveMerchantApplication('profile-123', 'admin-123'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(
        transactionClient.merchantProfile.updateMany,
      ).not.toHaveBeenCalled();
    });

    // Verify that a superseded approved document cannot satisfy a required document type.
    it('rejects approval when the only approved document for a required type is superseded', async () => {
      transactionClient.merchantProfile.findUnique.mockResolvedValue({
        ...validProfile,
        documents: [
          makeDocument(
            'NATIONAL_ID_FRONT',
            DocumentStatus.APPROVED,
            null,
            new Date('2026-02-01T00:00:00.000Z'),
            'replacement-document-123',
          ),
          makeDocument('NATIONAL_ID_BACK', DocumentStatus.APPROVED),
        ],
      });

      await expect(
        service.approveMerchantApplication('profile-123', 'admin-123'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(
        transactionClient.merchantProfile.updateMany,
      ).not.toHaveBeenCalled();

      expect(
        transactionClient.merchantReviewHistory.create,
      ).not.toHaveBeenCalled();
    });

    // Verify that approval is blocked if any currently uploaded document remains pending.
    it('rejects approval when any current uploaded document is still pending', async () => {
      transactionClient.merchantProfile.findUnique.mockResolvedValue({
        ...validProfile,
        documents: [
          ...validProfile.documents,
          makeDocument('PROOF_OF_ADDRESS', DocumentStatus.PENDING),
        ],
      });

      await expect(
        service.approveMerchantApplication('profile-123', 'admin-123'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(
        transactionClient.merchantProfile.updateMany,
      ).not.toHaveBeenCalled();
    });

    // Verify that approval fails if any current document has passed its expiration date.
    it('rejects approval when a current uploaded document has expired', async () => {
      transactionClient.merchantProfile.findUnique.mockResolvedValue({
        ...validProfile,
        documents: [
          ...validProfile.documents,
          makeDocument(
            'PROOF_OF_ADDRESS',
            DocumentStatus.APPROVED,
            new Date('2020-01-01T00:00:00.000Z'),
          ),
        ],
      });

      await expect(
        service.approveMerchantApplication('profile-123', 'admin-123'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(
        transactionClient.merchantProfile.updateMany,
      ).not.toHaveBeenCalled();
    });

    // Verify that pending documents that have been superseded do not block approval if a valid replacement exists.
    it('ignores a superseded pending document when its replacement is valid', async () => {
      transactionClient.merchantProfile.findUnique.mockResolvedValue({
        ...validProfile,
        documents: [
          ...validProfile.documents,
          makeDocument(
            'PROOF_OF_ADDRESS',
            DocumentStatus.PENDING,
            null,
            new Date(),
            'address-replacement-123',
          ),
          makeDocument('PROOF_OF_ADDRESS', DocumentStatus.APPROVED),
        ],
      });

      await expect(
        service.approveMerchantApplication('profile-123', 'admin-123'),
      ).resolves.toMatchObject({
        accountStatus: AccountStatus.APPROVED,
      });
    });
  });

  // Test suite for rejecting merchant applications.
  describe('rejectMerchantApplication', () => {
    const profileId = 'profile-123';
    const adminId = 'admin-123';
    const reason = 'Business registration document is invalid.';

    beforeEach(() => {
      vi.clearAllMocks();

      databaseService.$transaction.mockImplementation(
        async (callback) => callback(transactionClient),
      );
    });

    it('rejects an application under review and records history', async () => {
      transactionClient.merchantProfile.findUnique.mockResolvedValue({
        id: profileId,
        accountStatus: AccountStatus.UNDER_REVIEW,
      });

      transactionClient.merchantProfile.updateMany.mockResolvedValue({
        count: 1,
      });

      transactionClient.merchantReviewHistory.create.mockResolvedValue({});

      await expect(
        service.rejectMerchantApplication(profileId, adminId, `  ${reason}  `),
      ).resolves.toEqual({
        profileId,
        accountStatus: AccountStatus.REJECTED,
        rejectionReason: reason,
        message: 'Merchant application rejected.',
      });

      expect(transactionClient.merchantProfile.updateMany).toHaveBeenCalledWith({
        where: {
          id: profileId,
          accountStatus: AccountStatus.UNDER_REVIEW,
        },
        data: {
          accountStatus: AccountStatus.REJECTED,
          rejectionReason: reason,
        },
      });

      expect(
        transactionClient.merchantReviewHistory.create,
      ).toHaveBeenCalledWith({
        data: {
          profileId,
          fromStatus: AccountStatus.UNDER_REVIEW,
          toStatus: AccountStatus.REJECTED,
          note: reason,
          actorType: ProfileActorType.ADMIN,
          actorId: adminId,
        },
      });
    });

    it.each([0, 2])('rejects a transition that updates %i rows without recording history', async (count) => {
      transactionClient.merchantProfile.findUnique.mockResolvedValue({
        id: profileId,
        accountStatus: AccountStatus.UNDER_REVIEW,
      });
      transactionClient.merchantProfile.updateMany.mockResolvedValue({ count });

      await expect(
        service.rejectMerchantApplication(profileId, adminId, reason),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(transactionClient.merchantReviewHistory.create).not.toHaveBeenCalled();
    });

    it('rejects an empty reason', async () => {
      await expect(
        service.rejectMerchantApplication(profileId, adminId, '   '),
      ).rejects.toThrow(BadRequestException);

      expect(databaseService.$transaction).not.toHaveBeenCalled();
    });

    it('throws when the application does not exist', async () => {
      transactionClient.merchantProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.rejectMerchantApplication(profileId, adminId, reason),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects an application that is not under review', async () => {
      transactionClient.merchantProfile.findUnique.mockResolvedValue({
        id: profileId,
        accountStatus: AccountStatus.SUBMITTED,
      });

      await expect(
        service.rejectMerchantApplication(profileId, adminId, reason),
      ).rejects.toThrow(ConflictException);

      expect(transactionClient.merchantProfile.updateMany).not.toHaveBeenCalled();
      expect(
        transactionClient.merchantReviewHistory.create,
      ).not.toHaveBeenCalled();
    });
  });
});
