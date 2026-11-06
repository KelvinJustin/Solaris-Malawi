
import { SetMetadata } from '@nestjs/common';

import { AdminRole } from '../generated/prisma/enums.js';

// Metadata key used by the admin role guard.
export const ADMIN_ROLES_KEY = 'admin_roles';

// Declare which admin roles are allowed to access a route.
export const AdminRoles = (...roles: AdminRole[]) =>
    SetMetadata(ADMIN_ROLES_KEY, roles);
