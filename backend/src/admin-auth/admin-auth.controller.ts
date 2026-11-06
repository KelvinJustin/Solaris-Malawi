import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Post,
    Req,
    Res,
    UnauthorizedException,
    UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';

import { AdminAuthService } from './admin-auth.service.js';
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard.js';
import { AdminLoginDto } from './dto/admin-login.dto.js';

interface AdminRequestUser {
    adminId: string;
    email: string;
    role: string;
    jti: string;
    exp: number;
}

type AdminRequest = Request & {
    user: AdminRequestUser;
};

@Controller('admin-auth')
export class AdminAuthController {
    constructor(
        private readonly adminAuthService: AdminAuthService,
        private readonly configService: ConfigService,
    ) { }

    private cookieOptions(): CookieOptions {
        return {
            httpOnly: true,
            secure: this.configService.get('NODE_ENV') === 'production',
            sameSite: 'lax',
            path: '/',
        };
    }

    @Post('login')
    @HttpCode(HttpStatus.OK)
    async login(
        @Body() dto: AdminLoginDto,
        @Res({ passthrough: true }) response: Response,
    ) {
        const result = await this.adminAuthService.login(dto.email, dto.password);

        response.cookie('admin_access_token', result.accessToken, {
            ...this.cookieOptions(),
            maxAge: 15 * 60 * 1000,
        });

        // Never return the JWT in the response body.
        return {
            message: 'Admin login successful',
            admin: result.admin,
        };
    }

    @Post('logout')
    @HttpCode(HttpStatus.OK)
    @UseGuards(AdminJwtAuthGuard)
    async logout(
        @Req() request: AdminRequest,
        @Res({ passthrough: true }) response: Response,
    ) {
        const user = request.user;

        if (!user?.adminId || !user.jti || !user.exp) {
            throw new UnauthorizedException('Invalid admin session');
        }

        const result = await this.adminAuthService.logout({
            adminId: user.adminId,
            jti: user.jti,
            exp: user.exp,
        });

        response.clearCookie('admin_access_token', this.cookieOptions());

        return result;
    }

    @Get('me')
    @UseGuards(AdminJwtAuthGuard)
    me(@Req() request: AdminRequest) {
        const { adminId, email, role } = request.user;

        return {
            id: adminId,
            email,
            role,
        };
    }
}
