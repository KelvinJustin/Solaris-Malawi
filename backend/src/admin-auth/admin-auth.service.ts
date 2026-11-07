
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
     * Authenticates an internal admin using the email/password form.
     *
     * The admin domain is intentionally separate from merchant sign-in. These
     * users are provisioned by trusted operators and are never allowed to self-register.
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
     * Revokes the current admin JWT so it cannot be reused by a stale client.
     *
     * The controller clears the cookie at the same time, but the denylist entry is
     * the source of truth for whether the token is still valid.
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
