
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

describe('AdminController', () => {
  let controller: AdminController;

  const adminService = {
  findMerchantApplications: vi.fn(),
  findMerchantApplicationById: vi.fn(),
  startMerchantApplicationReview: vi.fn(),
  rejectMerchantApplication: vi.fn(),
};

  beforeEach(async () => {
    vi.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        {
          provide: AdminService,
          useValue: adminService,
        },
      ],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  describe('controller initialization', () => {
    it('should be defined', () => {
      expect(controller).toBeDefined();
    });
  });

  describe('findMerchantApplications', () => {
    it('should use default pagination values', async () => {
      const applications = {
        data: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
        },
      };

      adminService.findMerchantApplications.mockResolvedValue(
        applications,
      );

      const result = await controller.findMerchantApplications();

      expect(
        adminService.findMerchantApplications,
      ).toHaveBeenCalledWith(1, 20);

      expect(result).toEqual(applications);
    });

    it('should convert pagination query parameters to numbers', async () => {
      const applications = {
        data: [],
        pagination: {
          page: 2,
          limit: 10,
          total: 0,
          totalPages: 0,
        },
      };

      adminService.findMerchantApplications.mockResolvedValue(
        applications,
      );

      const result = await controller.findMerchantApplications(
        '2',
        '10',
      );

      expect(
        adminService.findMerchantApplications,
      ).toHaveBeenCalledWith(2, 10);

      expect(result).toEqual(applications);
    });

    it('should return the service result', async () => {
      const applications = {
        data: [{ id: 'profile-123' }],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
        },
      };

      adminService.findMerchantApplications.mockResolvedValue(
        applications,
      );

      await expect(
        controller.findMerchantApplications('1', '20'),
      ).resolves.toEqual(applications);
    });

    it('should propagate service errors', async () => {
      const error = new Error('Database unavailable');

      adminService.findMerchantApplications.mockRejectedValue(error);

      await expect(
        controller.findMerchantApplications('1', '20'),
      ).rejects.toThrow('Database unavailable');
    });
  });

  describe('findMerchantApplicationById', () => {
    it('should request the application using its profile ID', async () => {
      const application = {
        id: 'profile-123',
        businessName: 'Test Business',
        documents: [],
        reviewHistory: [],
      };

      adminService.findMerchantApplicationById.mockResolvedValue(
        application,
      );

      const result =
        await controller.findMerchantApplicationById('profile-123');

      expect(
        adminService.findMerchantApplicationById,
      ).toHaveBeenCalledWith('profile-123');

      expect(result).toEqual(application);
    });

    it('should propagate errors when the application cannot be retrieved', async () => {
      adminService.findMerchantApplicationById.mockRejectedValue(
        new Error('Merchant application not found.'),
      );

      await expect(
        controller.findMerchantApplicationById('missing-profile'),
      ).rejects.toThrow('Merchant application not found.');
    });
  });

  describe('startMerchantApplicationReview', () => {
  it('should pass the profile ID and authenticated admin ID to the service', async () => {
    const result = {
      profileId: 'profile-123',
      accountStatus: 'UNDER_REVIEW',
      message: 'Merchant application review started.',
    };

    adminService.startMerchantApplicationReview.mockResolvedValue(result);

    const request = {
      user: {
        adminId: 'admin-123',
        role: 'COMPLIANCE',
      },
    } as any;

    const response = await controller.startMerchantApplicationReview(
      'profile-123',
      request,
    );

    expect(
      adminService.startMerchantApplicationReview,
    ).toHaveBeenCalledWith('profile-123', 'admin-123');

    expect(response).toEqual(result);
  });
});

  describe('rejectMerchantApplication', () => {
    const request = {
      user: { adminId: 'admin-123', role: 'COMPLIANCE' },
    } as unknown as Request;

    it.each([undefined, null, 42, true, {}, []])(
      'returns HTTP 400 for a non-string reason (%j) before calling the service',
      (reason) => {
        try {
          void controller.rejectMerchantApplication('profile-123', request, reason);
          throw new Error('Expected rejection reason validation to fail');
        } catch (error) {
          expect(error).toBeInstanceOf(BadRequestException);
          expect((error as BadRequestException).getStatus()).toBe(400);
        }
        expect(adminService.rejectMerchantApplication).not.toHaveBeenCalled();
      },
    );

    it('passes a validated string and the authenticated admin ID to the service', async () => {
      const result = { profileId: 'profile-123', accountStatus: 'REJECTED' };
      adminService.rejectMerchantApplication.mockResolvedValue(result);

      await expect(
        controller.rejectMerchantApplication('profile-123', request, 'Invalid document'),
      ).resolves.toEqual(result);

      expect(adminService.rejectMerchantApplication).toHaveBeenCalledWith(
        'profile-123', 'admin-123', 'Invalid document',
      );
    });
  });
});
