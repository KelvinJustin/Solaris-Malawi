
import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AdminRole } from '../generated/prisma/enums.js';
import { ADMIN_ROLES_KEY } from './admin-roles.decorator.js';

interface AuthenticatedAdmin {
    adminId: string;
    email: string;
    role: AdminRole;
}

interface AdminRequest {
    user?: AuthenticatedAdmin;
}

@Injectable()
export class AdminRolesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        // Read the roles allowed by the route's @AdminRoles() decorator.
        const requiredRoles = this.reflector.getAllAndOverride<AdminRole[]>(
            ADMIN_ROLES_KEY,
            [context.getHandler(), context.getClass()],
        );

        // Routes without role metadata are not restricted by this guard.
        // Authentication is still enforced separately by AdminJwtAuthGuard.
        if (!requiredRoles?.length) {
            return true;
        }

        // Passport attaches the authenticated admin to request.user.
        const request = context.switchToHttp().getRequest<AdminRequest>();
        const admin = request.user;

        if (!admin || !requiredRoles.includes(admin.role)) {
            throw new ForbiddenException(
                'You do not have permission to perform this action.',
            );
        }

        return true;
    }
}
