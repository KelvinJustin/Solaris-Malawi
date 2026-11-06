
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';

import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthService } from './admin-auth.service.js';

describe('AdminAuthController', () => {
    let controller: AdminAuthController;

    const mockAdminAuthService = {
        login: vi.fn(),
        logout: vi.fn(),
    };

    const mockConfigService = {
        get: vi.fn((key: string) =>
            key === 'NODE_ENV' ? 'test' : undefined,
        ),
    };

    let mockResponse: {
        cookie: ReturnType<typeof vi.fn>;
        clearCookie: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
        vi.clearAllMocks();

        mockResponse = {
            cookie: vi.fn(),
            clearCookie: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [AdminAuthController],
            providers: [
                {
                    provide: AdminAuthService,
                    useValue: mockAdminAuthService,
                },
                {
                    provide: ConfigService,
                    useValue: mockConfigService,
                },
            ],
        }).compile();

        controller = module.get<AdminAuthController>(
            AdminAuthController,
        );
    });

    describe('controller initialization', () => {
        it('should be defined', () => {
            expect(controller).toBeDefined();
        });
    });

    describe('login', () => {
        const credentials = {
            email: 'admin@example.com',
            password: 'StrongTestPassword123!',
        };

        const admin = {
            id: 'admin-uuid',
            name: 'System Administrator',
            email: 'admin@example.com',
            role: 'SUPER_ADMIN',
        };

        beforeEach(() => {
            mockAdminAuthService.login.mockResolvedValue({
                accessToken: 'test-admin-jwt',
                admin,
            });
        });

        it('should authenticate the admin and set the HTTP-only cookie', async () => {
            const result = await controller.login(
                credentials,
                mockResponse as unknown as Response,
            );

            expect(mockAdminAuthService.login).toHaveBeenCalledOnce();
            expect(mockAdminAuthService.login).toHaveBeenCalledWith(
                credentials.email,
                credentials.password,
            );

            expect(mockResponse.cookie).toHaveBeenCalledOnce();
            expect(mockResponse.cookie).toHaveBeenCalledWith(
                'admin_access_token',
                'test-admin-jwt',
                {
                    httpOnly: true,
                    secure: false,
                    sameSite: 'lax',
                    path: '/',
                    maxAge: 15 * 60 * 1000,
                },
            );

            expect(result).toEqual({
                message: 'Admin login successful',
                admin,
            });

            // The JWT must never be returned in the response body.
            expect(result).not.toHaveProperty('accessToken');
        });

        it('should not set a cookie if authentication fails', async () => {
            mockAdminAuthService.login.mockRejectedValue(
                new Error('Authentication failed'),
            );

            await expect(
                controller.login(
                    credentials,
                    mockResponse as unknown as Response,
                ),
            ).rejects.toThrow('Authentication failed');

            expect(mockResponse.cookie).not.toHaveBeenCalled();
        });
    });

    describe('me', () => {
        it('should return the authenticated admin details', () => {
            const request = {
                user: {
                    adminId: 'admin-uuid',
                    email: 'admin@example.com',
                    role: 'SUPER_ADMIN',
                    jti: 'test-token-uuid',
                    exp: 1_900_000_000,
                },
            };

            const result = controller.me(request as never);

            expect(result).toEqual({
                id: 'admin-uuid',
                email: 'admin@example.com',
                role: 'SUPER_ADMIN',
            });

            expect(result).not.toHaveProperty('jti');
            expect(result).not.toHaveProperty('exp');
        });
    });

    describe('logout', () => {
        const user = {
            adminId: 'admin-uuid',
            email: 'admin@example.com',
            role: 'SUPER_ADMIN',
            jti: 'test-token-uuid',
            exp: 1_900_000_000,
        };

        beforeEach(() => {
            mockAdminAuthService.logout.mockResolvedValue({
                message: 'Admin logged out successfully',
            });
        });

        it('should revoke the session and clear the admin cookie', async () => {
            const request = { user };

            const result = await controller.logout(
                request as never,
                mockResponse as unknown as Response,
            );

            expect(mockAdminAuthService.logout).toHaveBeenCalledOnce();
            expect(mockAdminAuthService.logout).toHaveBeenCalledWith({
                adminId: user.adminId,
                jti: user.jti,
                exp: user.exp,
            });

            expect(mockResponse.clearCookie).toHaveBeenCalledOnce();
            expect(mockResponse.clearCookie).toHaveBeenCalledWith(
                'admin_access_token',
                {
                    httpOnly: true,
                    secure: false,
                    sameSite: 'lax',
                    path: '/',
                },
            );

            expect(result).toEqual({
                message: 'Admin logged out successfully',
            });
        });

        it('should reject a request without an admin ID', async () => {
            const request = {
                user: {
                    ...user,
                    adminId: '',
                },
            };

            await expect(
                controller.logout(
                    request as never,
                    mockResponse as unknown as Response,
                ),
            ).rejects.toThrow('Invalid admin session');

            expect(mockAdminAuthService.logout).not.toHaveBeenCalled();
            expect(mockResponse.clearCookie).not.toHaveBeenCalled();
        });

        it('should reject a request without a JWT ID', async () => {
            const request = {
                user: {
                    ...user,
                    jti: '',
                },
            };

            await expect(
                controller.logout(
                    request as never,
                    mockResponse as unknown as Response,
                ),
            ).rejects.toThrow('Invalid admin session');

            expect(mockAdminAuthService.logout).not.toHaveBeenCalled();
            expect(mockResponse.clearCookie).not.toHaveBeenCalled();
        });

        it('should reject a request without an expiry timestamp', async () => {
            const request = {
                user: {
                    ...user,
                    exp: 0,
                },
            };

            await expect(
                controller.logout(
                    request as never,
                    mockResponse as unknown as Response,
                ),
            ).rejects.toThrow('Invalid admin session');

            expect(mockAdminAuthService.logout).not.toHaveBeenCalled();
            expect(mockResponse.clearCookie).not.toHaveBeenCalled();
        });

        it('should not clear the cookie if session revocation fails', async () => {
            mockAdminAuthService.logout.mockRejectedValue(
                new Error('Database error'),
            );

            await expect(
                controller.logout(
                    { user } as never,
                    mockResponse as unknown as Response,
                ),
            ).rejects.toThrow('Database error');

            expect(mockResponse.clearCookie).not.toHaveBeenCalled();
        });
    });
});
