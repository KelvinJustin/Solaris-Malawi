
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Thin wrapper around the admin Passport JWT strategy.
 *
 * This keeps the admin routes explicit while reusing the same validation path
 * everywhere auth is required.
 */
@Injectable()
export class AdminJwtAuthGuard extends AuthGuard('admin-jwt') {}
