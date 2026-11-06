
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { DatabaseModule } from '../database/database.module.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminJwtStrategy } from './admin-jwt.strategy.js';
import { AdminAuthController } from './admin-auth.controller.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    PassportModule.register({ defaultStrategy: 'admin-jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [AdminAuthController],
  providers: [
    AdminAuthService,
    AdminJwtStrategy,
  ],
  exports: [AdminAuthService],
})
export class AdminAuthModule {}
