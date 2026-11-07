import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Thin wrapper around the Passport JWT strategy.
 *
 * This keeps the route decorators readable while ensuring all authenticated
 * merchant routes still go through the same JWT validation logic.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}