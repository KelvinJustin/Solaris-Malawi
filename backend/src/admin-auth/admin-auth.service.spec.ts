import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';

const TEST_JTI = '123e4567-e89b-42d3-a456-426614174000';

vi.mock('bcrypt', () => {
    const compare = vi.fn();

    return {
        compare,
        default: { compare },
    };
});

vi.mock('node:crypto', () => ({
    randomUUID: vi.fn(),
}));

describe('AdminAuthService', () => {
    let service: AdminAuthService;

    const mockDatabaseService = {
        admin: {
            findUnique: vi.fn(),
            update: vi.fn(),
        },
        adminRevokedToken: {
            create: vi.fn(),
        },
    };

    const mockJwtService = {
        signAsync: vi.fn(),
    };

    const mockAdmin = {
        id: 'admin-uuid',
        name: 'System Administrator',
        email: 'admin@example.com',
        passwordHash: 'hashed-password',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        deletedAt: null,
        lastLoginAt: null,
    };

    beforeEach(async () => {
        vi.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AdminAuthService,
                { provide: DatabaseService, useValue: mockDatabaseService },
                { provide: JwtService, useValue: mockJwtService },
            ],
        }).compile();

        service = module.get<AdminAuthService>(AdminAuthService);

        mockDatabaseService.admin.findUnique.mockResolvedValue({
            ...mockAdmin,
        });

        mockDatabaseService.admin.update.mockResolvedValue({
            ...mockAdmin,
            lastLoginAt: new Date(),
        });

        mockDatabaseService.adminRevokedToken.create.mockResolvedValue({
            jti: TEST_JTI,
        });

        vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
        vi.mocked(randomUUID).mockReturnValue(TEST_JTI);
        mockJwtService.signAsync.mockResolvedValue('test-admin-jwt');
    });

    describe('initialization', () => {
        it('should be defined', () => {
            expect(service).toBeDefined();
        });
    });

    describe('login', () => {
        it('authenticates an active admin and returns an access token', async () => {
            const result = await service.login(
                'admin@example.com',
                'StrongTestPassword123!',
            );

            expect(mockDatabaseService.admin.findUnique).toHaveBeenCalledWith({
                where: { email: 'admin@example.com' },
            });

            expect(bcrypt.compare).toHaveBeenCalledWith(
                'StrongTestPassword123!',
                mockAdmin.passwordHash,
            );

            expect(mockJwtService.signAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    sub: mockAdmin.id,
                    email: mockAdmin.email,
                    role: mockAdmin.role,
                    jti: TEST_JTI,
                }),
            );

            expect(mockDatabaseService.admin.update).toHaveBeenCalledWith({
                where: { id: mockAdmin.id },
                data: { lastLoginAt: expect.any(Date) },
            });

            expect(result).toEqual({
                accessToken: 'test-admin-jwt',
                admin: {
                    id: mockAdmin.id,
                    name: mockAdmin.name,
                    email: mockAdmin.email,
                    role: mockAdmin.role,
                },
            });
        });

        it('rejects an admin who does not exist', async () => {
            mockDatabaseService.admin.findUnique.mockResolvedValue(null);

            await expect(
                service.login('unknown@example.com', 'SomePassword123!'),
            ).rejects.toThrow(UnauthorizedException);

            expect(bcrypt.compare).not.toHaveBeenCalled();
            expect(mockJwtService.signAsync).not.toHaveBeenCalled();
            expect(mockDatabaseService.admin.update).not.toHaveBeenCalled();
        });

        it('rejects an incorrect password', async () => {
            vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

            await expect(
                service.login('admin@example.com', 'WrongPassword123!'),
            ).rejects.toThrow(UnauthorizedException);

            expect(mockJwtService.signAsync).not.toHaveBeenCalled();
            expect(mockDatabaseService.admin.update).not.toHaveBeenCalled();
        });

        it('rejects a suspended admin', async () => {
            mockDatabaseService.admin.findUnique.mockResolvedValue({
                ...mockAdmin,
                status: 'SUSPENDED',
            });

            await expect(
                service.login('admin@example.com', 'StrongTestPassword123!'),
            ).rejects.toThrow(UnauthorizedException);

            expect(mockJwtService.signAsync).not.toHaveBeenCalled();
        });

        it('rejects a deleted admin', async () => {
            mockDatabaseService.admin.findUnique.mockResolvedValue({
                ...mockAdmin,
                deletedAt: new Date(),
            });

            await expect(
                service.login('admin@example.com', 'StrongTestPassword123!'),
            ).rejects.toThrow(UnauthorizedException);

            expect(mockJwtService.signAsync).not.toHaveBeenCalled();
        });

        it('propagates a database lookup error', async () => {
            mockDatabaseService.admin.findUnique.mockRejectedValue(
                new Error('Database unavailable'),
            );

            await expect(
                service.login('admin@example.com', 'StrongTestPassword123!'),
            ).rejects.toThrow('Database unavailable');
        });

        it('propagates a JWT signing error', async () => {
            mockJwtService.signAsync.mockRejectedValue(
                new Error('JWT signing failed'),
            );

            await expect(
                service.login('admin@example.com', 'StrongTestPassword123!'),
            ).rejects.toThrow('JWT signing failed');
        });
    });

    describe('logout', () => {
        const session = {
            adminId: 'admin-uuid',
            jti: TEST_JTI,
            exp: 1_900_000_000,
        };

        it('records the revoked token with its admin and expiry', async () => {
            const result = await service.logout(session);

            expect(
                mockDatabaseService.adminRevokedToken.create,
            ).toHaveBeenCalledWith({
                data: {
                    jti: session.jti,
                    adminId: session.adminId,
                    expiresAt: new Date(session.exp * 1000),
                },
            });

            expect(result).toEqual({
                message: 'Admin logged out successfully',
            });
        });

        it('propagates an error if token revocation fails', async () => {
            mockDatabaseService.adminRevokedToken.create.mockRejectedValue(
                new Error('Database unavailable'),
            );

            await expect(service.logout(session)).rejects.toThrow(
                'Database unavailable',
            );
        });
    });
});