
import { SetMetadata } from '@nestjs/common';

import { AdminRole } from '../generated/prisma/enums.js';

/**
 * Metadata key used by the admin role guard.
 *
 * The decorator stores the allowed roles on the route metadata so access checks
 * can be evaluated centrally without sprinkling authorization checks through
 * every handler.
 */
export const ADMIN_ROLES_KEY = 'admin_roles';

/**
 * Declares which admin roles are allowed to access a route.
 */
export const AdminRoles = (...roles: AdminRole[]) =>
    SetMetadata(ADMIN_ROLES_KEY, roles);
