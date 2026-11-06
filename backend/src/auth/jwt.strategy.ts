import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { DatabaseService } from '../database/database.service.js';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  // Dependency injection: configService is used to retrieve the JWT signing secret.
  constructor(
    configService: ConfigService,
    private readonly databaseService: DatabaseService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request) => request?.cookies?.access_token ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: {
    sub: string;
    email: string;
    jti: string;
    exp: number;
  }) {
    // Reject malformed tokens before querying the database.
    if (
      !payload.sub ||
      !payload.email ||
      !payload.jti ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      throw new UnauthorizedException('Invalid authentication token');
    }

    // Reject tokens that have already been revoked.
    const revokedToken =
      await this.databaseService.revokedToken.findUnique({
        where: { jti: payload.jti },
        select: { id: true },
      });

    if (revokedToken) {
      throw new UnauthorizedException('Token has been revoked');
    }

    // Load the account and its business profile.
    const merchant = await this.databaseService.merchant.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        deletedAt: true,
        profile: {
          select: {
            accountStatus: true,
          },
        },
      },
    });

    if (!merchant || merchant.deletedAt) {
      throw new UnauthorizedException('This account no longer exists');
    }

    // A suspended business profile must not use authenticated endpoints.
    if (merchant.profile?.accountStatus === 'SUSPENDED') {
      throw new UnauthorizedException('This account is suspended');
    }

    // Preserve token metadata so logout can revoke this exact JWT.
    return {
      userId: merchant.id,
      email: merchant.email,
      jti: payload.jti,
      exp: payload.exp,
    };
  }

}
