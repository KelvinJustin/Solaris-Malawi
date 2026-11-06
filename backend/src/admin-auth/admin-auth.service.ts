
import {
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';

import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class AdminAuthService {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly jwtService: JwtService,
    ) { }

    /**
     * Authenticate an administrator using email and password.
     *
     * Admin accounts are provisioned by process;
     * there is intentionally no public registration method.
     */
    async login(email: string, password: string) {
        const admin = await this.databaseService.admin.findUnique({
            where: { email },
        });

        // Use a generic error so we don't reveal whether an email exists.
        if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
            throw new UnauthorizedException('Invalid email or password');
        }

        // Suspended or soft-deleted administrators cannot sign in.
        if (admin.status !== 'ACTIVE' || admin.deletedAt) {
            throw new UnauthorizedException('Admin account is unavailable');
        }

        const jti = randomUUID();

        const accessToken = await this.jwtService.signAsync({
            sub: admin.id,
            email: admin.email,
            role: admin.role,
            jti,
        });

        await this.databaseService.admin.update({
            where: { id: admin.id },
            data: { lastLoginAt: new Date() },
        });

        return {
            accessToken,
            admin: {
                id: admin.id,
                name: admin.name,
                email: admin.email,
                role: admin.role,
            },
        };
    }

    /**
     * Revoke the current admin JWT so it cannot be reused.
     * The controller should also clear the admin cookie.
     */
    async logout(admin: { adminId: string; jti: string; exp: number }) {
        await this.databaseService.adminRevokedToken.create({
            data: {
                jti: admin.jti,
                adminId: admin.adminId,
                expiresAt: new Date(admin.exp * 1000),
            },
        });

        return { message: 'Admin logged out successfully' };
    }
}
