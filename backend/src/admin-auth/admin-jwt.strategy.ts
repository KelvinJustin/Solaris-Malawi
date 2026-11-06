
import {
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(
    Strategy,
    'admin-jwt',
) {
    constructor(
        configService: ConfigService,
        private readonly databaseService: DatabaseService,
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromExtractors([
                (request) => request?.cookies?.admin_access_token ?? null,
                ExtractJwt.fromAuthHeaderAsBearerToken(),
            ]),
            ignoreExpiration: false,
            secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
        });
    }

    async validate(payload: {
        sub: string;
        email: string;
        role: string;
        jti: string;
        exp: number;
    }) {
        if (
            !payload.sub ||
            !payload.jti ||
            !payload.exp ||
            !payload.email ||
            !payload.role
        ) {
            throw new UnauthorizedException('Invalid admin token');
        }

        // Reject tokens that have been revoked during logout.
        const revokedToken =
            await this.databaseService.adminRevokedToken.findUnique({
                where: { jti: payload.jti },
                select: { id: true },
            });

        if (revokedToken) {
            throw new UnauthorizedException('Admin token has been revoked');
        }

        // Check the current database state rather than trusting the JWT role.
        const admin = await this.databaseService.admin.findUnique({
            where: { id: payload.sub },
            select: {
                id: true,
                email: true,
                role: true,
                status: true,
                deletedAt: true,
            },
        });

        if (
            !admin ||
            admin.status !== 'ACTIVE' ||
            admin.deletedAt ||
            admin.email !== payload.email
        ) {
            throw new UnauthorizedException('Admin account is unavailable');
        }

        return {
            adminId: admin.id,
            email: admin.email,
            role: admin.role,
            jti: payload.jti,
            exp: payload.exp,
        };
    }
}
