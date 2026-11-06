import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';

import { MerchantsController } from './merchants.controller.js';
import { MerchantsService } from './merchants.service.js';
import { MerchantDocumentsService } from './merchant-documents.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';

describe('MerchantsController', () => {
    let controller: MerchantsController;

    const mockMerchantsService = {
        getMyProfile: vi.fn(),
        updateProfile: vi.fn(),
        submitForReview: vi.fn(),
    };

    const mockMerchantDocumentsService = {
        requestUpload: vi.fn(),
        completeUpload: vi.fn(),
        listDocuments: vi.fn(),
    };

    const MERCHANT_ID = 'merchant-uuid';

    beforeEach(async () => {
        vi.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            controllers: [MerchantsController],
            providers: [
                {
                    provide: MerchantsService,
                    useValue: mockMerchantsService,
                },
                {
                    provide: MerchantDocumentsService,
                    useValue: mockMerchantDocumentsService,
                },
            ],
        }).compile();

        controller = module.get<MerchantsController>(MerchantsController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('getMyProfile', () => {
        it('should return the authenticated merchant profile', async () => {
            const profile = {
                id: MERCHANT_ID,
                name: 'Test Merchant',
                email: 'merchant@example.com',
            };

            mockMerchantsService.getMyProfile.mockResolvedValue(profile);

            await expect(controller.getMyProfile(MERCHANT_ID)).resolves.toEqual(
                profile,
            );

            expect(mockMerchantsService.getMyProfile).toHaveBeenCalledOnce();
            expect(mockMerchantsService.getMyProfile).toHaveBeenCalledWith(
                MERCHANT_ID,
            );
        });

        it('should propagate service errors', async () => {
            mockMerchantsService.getMyProfile.mockRejectedValue(
                new Error('Merchant not found'),
            );

            await expect(
                controller.getMyProfile(MERCHANT_ID),
            ).rejects.toThrow('Merchant not found');
        });
    });

    describe('updateProfile', () => {
        it('should update the authenticated merchant profile', async () => {
            const dto = {
                name: 'Updated Merchant',
            } as UpdateProfileDto;

            const updatedProfile = {
                id: MERCHANT_ID,
                name: 'Updated Merchant',
            };

            mockMerchantsService.updateProfile.mockResolvedValue(updatedProfile);

            await expect(
                controller.updateProfile(MERCHANT_ID, dto),
            ).resolves.toEqual(updatedProfile);

            expect(mockMerchantsService.updateProfile).toHaveBeenCalledOnce();
            expect(mockMerchantsService.updateProfile).toHaveBeenCalledWith(
                MERCHANT_ID,
                dto,
            );
        });

        it('should propagate service errors', async () => {
            const dto = {
                name: 'Updated Merchant',
            } as UpdateProfileDto;

            mockMerchantsService.updateProfile.mockRejectedValue(
                new Error('Profile update failed'),
            );

            await expect(
                controller.updateProfile(MERCHANT_ID, dto),
            ).rejects.toThrow('Profile update failed');
        });
    });

    describe('submitForReview', () => {
        it('should submit the merchant profile for review', async () => {
            const response = {
                message: 'Profile submitted for review',
            };

            mockMerchantsService.submitForReview.mockResolvedValue(response);

            await expect(
                controller.submitForReview(MERCHANT_ID),
            ).resolves.toEqual(response);

            expect(mockMerchantsService.submitForReview).toHaveBeenCalledOnce();
            expect(mockMerchantsService.submitForReview).toHaveBeenCalledWith(
                MERCHANT_ID,
            );
        });

        it('should propagate service errors', async () => {
            mockMerchantsService.submitForReview.mockRejectedValue(
                new Error('Profile cannot be submitted'),
            );

            await expect(
                controller.submitForReview(MERCHANT_ID),
            ).rejects.toThrow('Profile cannot be submitted');
        });
    });

    describe('document routes', () => {
        it('requests a document upload URL for the authenticated merchant', async () => {
            const dto = { type: 'NATIONAL_ID_FRONT', contentType: 'image/jpeg' } as any;
            const response = { uploadId: 'upload-1', uploadUrl: 'https://example.com/upload' };

            mockMerchantDocumentsService.requestUpload.mockResolvedValue(response);

            await expect(
                controller.requestDocumentUpload(MERCHANT_ID, dto),
            ).resolves.toEqual(response);

            expect(mockMerchantDocumentsService.requestUpload).toHaveBeenCalledWith(
                MERCHANT_ID,
                dto,
            );
        });

        it('completes a pending upload for the authenticated merchant', async () => {
            const response = { id: 'document-1', status: 'PENDING' };
            mockMerchantDocumentsService.completeUpload.mockResolvedValue(response);

            await expect(
                controller.completeDocumentUpload(MERCHANT_ID, 'upload-1'),
            ).resolves.toEqual(response);

            expect(mockMerchantDocumentsService.completeUpload).toHaveBeenCalledWith(
                MERCHANT_ID,
                'upload-1',
            );
        });

        it('lists merchant documents', async () => {
            const documents = [{ id: 'document-1', isCurrent: true }];
            mockMerchantDocumentsService.listDocuments.mockResolvedValue(documents);

            await expect(controller.listDocuments(MERCHANT_ID)).resolves.toEqual(documents);
            expect(mockMerchantDocumentsService.listDocuments).toHaveBeenCalledWith(
                MERCHANT_ID,
            );
        });
    });
});
