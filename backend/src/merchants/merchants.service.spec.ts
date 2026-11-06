
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import {
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';

import { MerchantsService } from './merchants.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
    AccountStatus,
    BusinessType,
    DocumentStatus,
    DocumentType,
    ProfileActorType,
} from '../generated/prisma/enums.js';

// --------------------------------------------------
// Test fixtures
// --------------------------------------------------

const merchantId = '123e4567-e89b-42d3-a456-426614174000';

const mockProfile = {
    id: '123e4567-e89b-42d3-a456-426614174001',
    merchantId,
    businessName: 'Example Business',
    businessType: BusinessType.INDIVIDUAL,
    businessRegistrationNumber: null,
    taxIdentificationNumber: null,
    businessAddress: 'Lilongwe, Malawi',
    accountStatus: AccountStatus.PENDING_SUBMISSION,
    rejectionReason: null,
    submittedAt: null,
    approvedAt: null,
    approvedById: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const mockDocuments = [
    {
        id: '123e4567-e89b-42d3-a456-426614174010',
        profileId: mockProfile.id,
        type: DocumentType.NATIONAL_ID_FRONT,
        status: DocumentStatus.APPROVED,
        expiresAt: null,

        // This is a current document, not a superseded document.
        supersededAt: null,
        supersededByDocumentId: null,
    },
    {
        id: '123e4567-e89b-42d3-a456-426614174011',
        profileId: mockProfile.id,
        type: DocumentType.NATIONAL_ID_BACK,
        status: DocumentStatus.PENDING,
        expiresAt: null,

        // This is a current document, not a superseded document.
        supersededAt: null,
        supersededByDocumentId: null,
    },
];

const mockProfileWithDocuments = {
    ...mockProfile,
    documents: mockDocuments,
};

// --------------------------------------------------
// Database mocks
// --------------------------------------------------

const mockTransactionClient = {
    merchantProfile: {
        update: vi.fn(),
        updateMany: vi.fn(),
        findUnique: vi.fn(),
    },
    merchantReviewHistory: {
        create: vi.fn(),
    },
};

const mockDatabaseService = {
    merchantProfile: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
    },

    // This mock invokes the transaction callback but does not
    // simulate PostgreSQL rollback behavior.
    $transaction: vi.fn(
        async (
            callback: (tx: typeof mockTransactionClient) => Promise<unknown>,
        ) => callback(mockTransactionClient),
    ),
};

// --------------------------------------------------
// Tests
// --------------------------------------------------

describe('MerchantsService', () => {
    let service: MerchantsService;

    beforeEach(async () => {
        vi.resetAllMocks();

        mockDatabaseService.$transaction.mockImplementation(
            async (
                callback: (tx: typeof mockTransactionClient) => Promise<unknown>,
            ) => callback(mockTransactionClient),
        );

        mockTransactionClient.merchantProfile.updateMany.mockResolvedValue({
            count: 1,
        });

        mockTransactionClient.merchantProfile.findUnique.mockResolvedValue({
            ...mockProfile,
            accountStatus: AccountStatus.SUBMITTED,
        });

        mockTransactionClient.merchantReviewHistory.create.mockResolvedValue({});

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MerchantsService,
                {
                    provide: DatabaseService,
                    useValue: mockDatabaseService,
                },
            ],
        }).compile();

        service = module.get<MerchantsService>(MerchantsService);
    });

    // ------------------------------------------------
    // Initialization
    // ------------------------------------------------

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    // ------------------------------------------------
    // Get profile
    // ------------------------------------------------

    describe('getMyProfile', () => {
        it('should return the merchant profile with documents', async () => {
            mockDatabaseService.merchantProfile.findUnique.mockResolvedValue(
                mockProfileWithDocuments,
            );

            const result = await service.getMyProfile(merchantId);

            expect(result).toEqual(mockProfileWithDocuments);

            expect(
                mockDatabaseService.merchantProfile.findUnique,
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { merchantId },
                    include: { documents: true },
                }),
            );
        });

        it('should throw NotFoundException when the profile does not exist', async () => {
            mockDatabaseService.merchantProfile.findUnique.mockResolvedValue(null);

            await expect(service.getMyProfile(merchantId)).rejects.toThrow(
                NotFoundException,
            );
        });

        it('should propagate database errors', async () => {
            mockDatabaseService.merchantProfile.findUnique.mockRejectedValue(
                new Error('Database unavailable'),
            );

            await expect(service.getMyProfile(merchantId)).rejects.toThrow(
                'Database unavailable',
            );
        });
    });

    // ------------------------------------------------
    // Update profile
    // ------------------------------------------------

    describe('updateProfile', () => {
        it('should update an editable profile', async () => {
            const updateDto = {
                businessName: 'Updated Business',
                businessAddress: 'Blantyre, Malawi',
            };

            mockDatabaseService.merchantProfile.findUnique.mockResolvedValue(
                mockProfile,
            );

            mockDatabaseService.merchantProfile.update.mockResolvedValue({
                ...mockProfile,
                ...updateDto,
            });

            const result = await service.updateProfile(merchantId, updateDto);

            expect(result).toMatchObject(updateDto);

            expect(
                mockDatabaseService.merchantProfile.update,
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { merchantId },
                    data: expect.objectContaining(updateDto),
                }),
            );
        });

        it('should allow updating a rejected profile', async () => {
            mockDatabaseService.merchantProfile.findUnique.mockResolvedValue({
                ...mockProfile,
                accountStatus: AccountStatus.REJECTED,
            });

            mockDatabaseService.merchantProfile.update.mockResolvedValue({
                ...mockProfile,
                accountStatus: AccountStatus.REJECTED,
                businessName: 'Corrected Business',
            });

            const result = await service.updateProfile(merchantId, {
                businessName: 'Corrected Business',
            });

            expect(result.businessName).toBe('Corrected Business');
        });

        it('should throw NotFoundException when the profile does not exist', async () => {
            mockDatabaseService.merchantProfile.findUnique.mockResolvedValue(null);

            await expect(
                service.updateProfile(merchantId, {
                    businessName: 'Updated Business',
                }),
            ).rejects.toThrow(NotFoundException);
        });

        it.each([
            AccountStatus.SUBMITTED,
            AccountStatus.UNDER_REVIEW,
            AccountStatus.APPROVED,
            AccountStatus.SUSPENDED,
        ])(
            'should reject updates when the profile status is %s',
            async (accountStatus) => {
                mockDatabaseService.merchantProfile.findUnique.mockResolvedValue({
                    ...mockProfile,
                    accountStatus,
                });

                await expect(
                    service.updateProfile(merchantId, {
                        businessName: 'Updated Business',
                    }),
                ).rejects.toThrow(BadRequestException);

                expect(
                    mockDatabaseService.merchantProfile.update,
                ).not.toHaveBeenCalled();
            },
        );

        it('should propagate database update errors', async () => {
            mockDatabaseService.merchantProfile.findUnique.mockResolvedValue(
                mockProfile,
            );

            mockDatabaseService.merchantProfile.update.mockRejectedValue(
                new Error('Database unavailable'),
            );

            await expect(
                service.updateProfile(merchantId, {
                    businessName: 'Updated Business',
                }),
            ).rejects.toThrow('Database unavailable');
        });
    });

    // ------------------------------------------------
    // Submit profile for review
    // ------------------------------------------------

    describe('submitForReview', () => {
        it('should submit a valid profile and create review history', async () => {
            mockDatabaseService.merchantProfile.findUnique.mockResolvedValue(
                mockProfileWithDocuments,
            );

            const result = await service.submitForReview(merchantId);

            expect(result.accountStatus).toBe(AccountStatus.SUBMITTED);

            expect(mockDatabaseService.$transaction).toHaveBeenCalledOnce();

            expect(
                mockTransactionClient.merchantProfile.updateMany,
            ).toHaveBeenCalledWith({
                where: {
                    merchantId,
                    accountStatus: AccountStatus.PENDING_SUBMISSION,
                },
                data: expect.objectContaining({
                    accountStatus: AccountStatus.SUBMITTED,
                    rejectionReason: null,
                }),
            });

            expect(
                mockTransactionClient.merchantReviewHistory.create,
            ).toHaveBeenCalledWith({
                data: {
                    profileId: mockProfile.id,
                    fromStatus: AccountStatus.PENDING_SUBMISSION,
                    toStatus: AccountStatus.SUBMITTED,
                    actorType: ProfileActorType.MERCHANT,
                    actorId: merchantId,
                },
            });
        });

        it('should allow a rejected profile to be resubmitted', async () => {
            const rejectedProfile = {
                ...mockProfile,
                accountStatus: AccountStatus.REJECTED,
                rejectionReason: 'Please correct the submitted details',
            };

            mockDatabaseService.merchantProfile.findUnique.mockResolvedValue({
                ...rejectedProfile,
                documents: mockDocuments,
            });

            mockTransactionClient.merchantProfile.findUnique.mockResolvedValue({
                ...rejectedProfile,
                accountStatus: AccountStatus.SUBMITTED,
                rejectionReason: null,
            });

            const result = await service.submitForReview(merchantId);

            expect(result.accountStatus).toBe(AccountStatus.SUBMITTED);

            expect(
                mockTransactionClient.merchantProfile.updateMany,
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        merchantId,
                        accountStatus: AccountStatus.REJECTED,
                    },
                }),
            );

            expect(
                mockTransactionClient.merchantReviewHistory.create,
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        fromStatus: AccountStatus.REJECTED,
                        toStatus: AccountStatus.SUBMITTED,
                    }),
                }),
            );
        });

        it('should throw NotFoundException when the profile does not exist', async () => {
            mockDatabaseService.merchantProfile.findUnique.mockResolvedValue(null);

            await expect(service.submitForReview(merchantId)).rejects.toThrow(
                NotFoundException,
            );

            expect(mockDatabaseService.$transaction).not.toHaveBeenCalled();
        });

        it.each([
            AccountStatus.SUBMITTED,
            AccountStatus.UNDER_REVIEW,
            AccountStatus.APPROVED,
            AccountStatus.SUSPENDED,
        ])(
            'should reject submission when the profile status is %s',
            async (accountStatus) => {
                mockDatabaseService.merchantProfile.findUnique.mockResolvedValue({
                    ...mockProfileWithDocuments,
                    accountStatus,
                });

                await expect(service.submitForReview(merchantId)).rejects.toThrow(
                    BadRequestException,
                );

                expect(mockDatabaseService.$transaction).not.toHaveBeenCalled();
            },
        );

        it('should reject submission when the business type is missing', async () => {
            mockDatabaseService.merchantProfile.findUnique.mockResolvedValue({
                ...mockProfileWithDocuments,
                businessType: null,
            });

            await expect(service.submitForReview(merchantId)).rejects.toThrow(
                BadRequestException,
            );
        });

        it('should reject submission when the business name is missing', async () => {
            mockDatabaseService.merchantProfile.findUnique.mockResolvedValue({
                ...mockProfileWithDocuments,
                businessName: '   ',
            });

            await expect(service.submitForReview(merchantId)).rejects.toThrow(
                BadRequestException,
            );
        });

        it('should reject submission when required documents are missing', async () => {
            mockDatabaseService.merchantProfile.findUnique.mockResolvedValue({
                ...mockProfile,
                documents: [],
            });

            await expect(service.submitForReview(merchantId)).rejects.toThrow(
                BadRequestException,
            );
        });

        it('should reject submission when a required document is rejected', async () => {
            mockDatabaseService.merchantProfile.findUnique.mockResolvedValue({
                ...mockProfile,
                documents: [
                    {
                        ...mockDocuments[0],
                        status: DocumentStatus.REJECTED,
                    },
                    mockDocuments[1],
                ],
            });

            await expect(service.submitForReview(merchantId)).rejects.toThrow(
                BadRequestException,
            );
        });

        it('should reject submission when a required document is expired', async () => {
            mockDatabaseService.merchantProfile.findUnique.mockResolvedValue({
                ...mockProfile,
                documents: [
                    {
                        ...mockDocuments[0],
                        status: DocumentStatus.EXPIRED,
                    },
                    mockDocuments[1],
                ],
            });

            await expect(service.submitForReview(merchantId)).rejects.toThrow(
                BadRequestException,
            );
        });

        it('should reject submission when a document expiry date has passed', async () => {
            mockDatabaseService.merchantProfile.findUnique.mockResolvedValue({
                ...mockProfile,
                documents: [
                    {
                        ...mockDocuments[0],
                        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
                    },
                    mockDocuments[1],
                ],
            });

            await expect(service.submitForReview(merchantId)).rejects.toThrow(
                BadRequestException,
            );
        });

        it('should reject submission when a superseded document is the only document for a required type', async () => {
            mockDatabaseService.merchantProfile.findUnique.mockResolvedValue({
                ...mockProfile,
                documents: [
                    {
                        ...mockDocuments[0],
                        supersededAt: new Date('2026-02-01T00:00:00.000Z'),
                        supersededByDocumentId:
                            '123e4567-e89b-42d3-a456-426614174099',
                    },
                    mockDocuments[1],
                ],
            });

            await expect(service.submitForReview(merchantId)).rejects.toThrow(
                BadRequestException,
            );

            expect(mockDatabaseService.$transaction).not.toHaveBeenCalled();
        });

        it('should reject submission when the conditional status update affects no rows', async () => {
            mockDatabaseService.merchantProfile.findUnique.mockResolvedValue(
                mockProfileWithDocuments,
            );

            // Simulate another request changing the profile status first.
            mockTransactionClient.merchantProfile.updateMany.mockResolvedValue({
                count: 0,
            });

            await expect(service.submitForReview(merchantId)).rejects.toThrow(
                BadRequestException,
            );

            expect(
                mockTransactionClient.merchantReviewHistory.create,
            ).not.toHaveBeenCalled();
        });

        it('should reject submission if the updated profile cannot be retrieved', async () => {
            mockDatabaseService.merchantProfile.findUnique.mockResolvedValue(
                mockProfileWithDocuments,
            );

            mockTransactionClient.merchantProfile.findUnique.mockResolvedValue(null);

            await expect(service.submitForReview(merchantId)).rejects.toThrow(
                NotFoundException,
            );

            expect(
                mockTransactionClient.merchantReviewHistory.create,
            ).not.toHaveBeenCalled();
        });

        it('should propagate database errors during submission', async () => {
            mockDatabaseService.merchantProfile.findUnique.mockResolvedValue(
                mockProfileWithDocuments,
            );

            mockTransactionClient.merchantProfile.updateMany.mockRejectedValue(
                new Error('Database unavailable'),
            );

            await expect(service.submitForReview(merchantId)).rejects.toThrow(
                'Database unavailable',
            );
        });
    });
});
