
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  type INestApplication,
  ValidationPipe,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcrypt';
import { createHmac } from 'node:crypto';

import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { ArcjetGuard } from '../arcjet/arcjet.guard.js';
import request from 'supertest';
import { DatabaseService } from '../database/database.service.js';
import { EmailService } from '../email/email.service.js';

describe('AuthService', () => {
  let service: AuthService;

  const otpSecret = 'test-only-otp-secret';

  const database = {
    merchant: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    otpChallenge: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    merchantProfile: {
      create: vi.fn(),
      update: vi.fn(),
    },
    revokedToken: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const jwt = {
    signAsync: vi.fn(),
  };

  const email = {
    sendVerificationCode: vi.fn(),
    sendLoginCode: vi.fn(),
  };

  const config = {
    getOrThrow: vi.fn((key: string) => {
      if (key === 'OTP_SECRET') return otpSecret;
      throw new Error(`Unexpected config key: ${key}`);
    }),
  };

  const merchant = {
    id: 'merchant-123',
    name: 'Test Merchant',
    email: 'merchant@example.com',
    phone: '+265991234567',
    passwordHash: '',
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    status: 'ACTIVE',
  };

  function hashOtp(merchantId: string, code: string) {
    return createHmac('sha256', otpSecret)
      .update(`${merchantId}:${code}`)
      .digest('hex');
  }

  function makeChallenge(overrides: Record<string, unknown> = {}) {
    return {
      id: 'challenge-123',
      merchantId: merchant.id,
      purpose: 'LOGIN',
      codeHash: hashOtp(merchant.id, '123456'),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      consumedAt: null,
      attempts: 0,
      createdAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();

    config.getOrThrow.mockImplementation((key: string) => {
      if (key === 'OTP_SECRET') return otpSecret;
      throw new Error(`Unexpected config key: ${key}`);
    });

    jwt.signAsync.mockResolvedValue('signed-test-jwt');
    email.sendVerificationCode.mockResolvedValue(undefined);
    email.sendLoginCode.mockResolvedValue(undefined);

    database.otpChallenge.updateMany.mockResolvedValue({ count: 1 });
    database.otpChallenge.update.mockResolvedValue({});
    database.revokedToken.create.mockResolvedValue({});
    database.merchant.update.mockResolvedValue({});
    database.merchantProfile.update.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DatabaseService, useValue: database },
        { provide: JwtService, useValue: jwt },
        { provide: EmailService, useValue: email },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('login', () => {
    it('rejects an unknown email', async () => {
      database.merchant.findUnique.mockResolvedValue(null);

      await expect(
        service.login({
          email: 'unknown@example.com',
          password: 'CorrectPassword123!',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(database.otpChallenge.create).not.toHaveBeenCalled();
      expect(email.sendLoginCode).not.toHaveBeenCalled();
    });

    it('rejects an incorrect password', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...merchant,
        passwordHash: await bcrypt.hash('CorrectPassword123!', 4),
      });

      await expect(
        service.login({
          email: merchant.email,
          password: 'WrongPassword123!',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(database.otpChallenge.create).not.toHaveBeenCalled();
      expect(email.sendLoginCode).not.toHaveBeenCalled();
    });

    it('rejects an unverified email', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...merchant,
        emailVerifiedAt: null,
        passwordHash: await bcrypt.hash('CorrectPassword123!', 4),
      });

      await expect(
        service.login({
          email: merchant.email,
          password: 'CorrectPassword123!',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(email.sendLoginCode).not.toHaveBeenCalled();
    });

    it('creates a login OTP and emails it after valid credentials', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...merchant,
        passwordHash: await bcrypt.hash('CorrectPassword123!', 4),
      });

      database.otpChallenge.create.mockResolvedValue({
        id: 'challenge-123',
      });

      const result = await service.login({
        email: merchant.email,
        password: 'CorrectPassword123!',
      });

      expect(result).toEqual({
        message: 'Login verification code sent',
        email: merchant.email,
      });

      expect(database.otpChallenge.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            merchantId: merchant.id,
            purpose: 'LOGIN',
            consumedAt: null,
          }),
        }),
      );

      expect(database.otpChallenge.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            merchantId: merchant.id,
            purpose: 'LOGIN',
            codeHash: expect.any(String),
            expiresAt: expect.any(Date),
          }),
        }),
      );

      expect(email.sendLoginCode).toHaveBeenCalledWith(
        merchant.email,
        expect.stringMatching(/^\d{6}$/),
      );
    });

    it('invalidates the new OTP if the email cannot be sent', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...merchant,
        passwordHash: await bcrypt.hash('CorrectPassword123!', 4),
      });

      database.otpChallenge.create.mockResolvedValue({
        id: 'challenge-123',
      });
      email.sendLoginCode.mockRejectedValue(new Error('SMTP unavailable'));

      await expect(
        service.login({
          email: merchant.email,
          password: 'CorrectPassword123!',
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(database.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'challenge-123' },
        data: { consumedAt: expect.any(Date) },
      });
    });
  });

  describe('verifyLogin', () => {
    it('rejects a missing merchant', async () => {
      database.merchant.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyLogin({
          email: merchant.email,
          code: '123456',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('rejects an unverified merchant', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...merchant,
        emailVerifiedAt: null,
      });

      await expect(
        service.verifyLogin({
          email: merchant.email,
          code: '123456',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a missing OTP challenge', async () => {
      database.merchant.findUnique.mockResolvedValue(merchant);
      database.otpChallenge.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyLogin({
          email: merchant.email,
          code: '123456',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an expired OTP', async () => {
      database.merchant.findUnique.mockResolvedValue(merchant);
      database.otpChallenge.findFirst.mockResolvedValue(
        makeChallenge({
          expiresAt: new Date(Date.now() - 1000),
        }),
      );

      await expect(
        service.verifyLogin({
          email: merchant.email,
          code: '123456',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a challenge that has reached the attempt limit', async () => {
      database.merchant.findUnique.mockResolvedValue(merchant);
      database.otpChallenge.findFirst.mockResolvedValue(
        makeChallenge({ attempts: 5 }),
      );

      await expect(
        service.verifyLogin({
          email: merchant.email,
          code: '123456',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('increments the attempt count for an incorrect OTP', async () => {
      database.merchant.findUnique.mockResolvedValue(merchant);
      database.otpChallenge.findFirst.mockResolvedValue(makeChallenge());

      await expect(
        service.verifyLogin({
          email: merchant.email,
          code: '999999',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(database.otpChallenge.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'challenge-123',
            attempts: { lt: 5 },
          }),
          data: { attempts: { increment: 1 } },
        }),
      );

      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('issues a JWT only after consuming a valid OTP', async () => {
      database.merchant.findUnique.mockResolvedValue(merchant);
      database.otpChallenge.findFirst.mockResolvedValue(makeChallenge());
      database.otpChallenge.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.verifyLogin({
        email: merchant.email,
        code: '123456',
      });

      expect(result.accessToken).toBe('signed-test-jwt');

      expect(database.otpChallenge.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'challenge-123',
            codeHash: hashOtp(merchant.id, '123456'),
            consumedAt: null,
          }),
          data: { consumedAt: expect.any(Date) },
        }),
      );

      expect(jwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: merchant.id,
          email: merchant.email,
          jti: expect.any(String),
        }),
      );
    });

    it('does not issue a JWT if OTP consumption loses a race', async () => {
      database.merchant.findUnique.mockResolvedValue(merchant);
      database.otpChallenge.findFirst.mockResolvedValue(makeChallenge());
      database.otpChallenge.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.verifyLogin({
          email: merchant.email,
          code: '123456',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(jwt.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('records the token identifier and expiry for revocation', async () => {
      const exp = Math.floor(Date.now() / 1000) + 600;

      const result = await service.logout({
        userId: merchant.id,
        jti: 'token-identifier',
        exp,
      });

      expect(result).toEqual({ message: 'Logged out successfully' });

      expect(database.revokedToken.create).toHaveBeenCalledWith({
        data: {
          jti: 'token-identifier',
          merchantId: merchant.id,
          expiresAt: new Date(exp * 1000),
        },
      });
    });
  });

  describe('deleteAccount', () => {
    it('rejects an account that does not exist', async () => {
      database.merchant.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteAccount(merchant.id),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(database.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an account that has already been deleted', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...merchant,
        deletedAt: new Date(),
        profile: null,
      });

      await expect(
        service.deleteAccount(merchant.id),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(database.$transaction).not.toHaveBeenCalled();
    });

    it('soft-deletes the merchant and suspends the profile', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...merchant,
        profile: { merchantId: merchant.id },
      });

      database.$transaction.mockImplementation(
        async (callback: (tx: typeof database) => Promise<unknown>) =>
          callback(database),
      );

      const result = await service.deleteAccount(merchant.id);

      expect(result).toEqual({
        message: 'Account deleted successfully',
      });

      expect(database.merchant.update).toHaveBeenCalledWith({
        where: { id: merchant.id },
        data: { deletedAt: expect.any(Date) },
      });

      expect(database.merchantProfile.update).toHaveBeenCalledWith({
        where: { merchantId: merchant.id },
        data: { accountStatus: 'SUSPENDED' },
      });
    });
  });
});


describe('AuthController email verification', () => {
  let app: INestApplication;
  const authService = { verifyEmail: vi.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    })
      .overrideGuard(ArcjetGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('starts the session: sets the HttpOnly access_token cookie and never returns the token', async () => {
    authService.verifyEmail.mockResolvedValue({
      message: 'Email verified successfully',
      accessToken: 'signed.jwt.token',
    });
    const dto = { email: 'merchant@example.com', code: '123456' };

    const response = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send(dto)
      .expect(201);

    expect(response.body).toEqual({
      message: 'Email verified successfully',
      redirectTo: '/home',
    });
    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain('access_token=signed.jwt.token');
    expect(cookies[0]).toContain('HttpOnly');
    expect(authService.verifyEmail).toHaveBeenCalledWith(dto);
  });
});

describe('AuthController.getProfile', () => {
  it('returns only the merchant identity, not the token metadata', () => {
    const controller = new AuthController({} as AuthService);

    const result = controller.getProfile({
      user: {
        userId: 'merchant-123',
        email: 'merchant@example.com',
        jti: 'token-identifier',
        exp: 1893456000,
      },
    } as never);

    expect(result).toEqual({
      userId: 'merchant-123',
      email: 'merchant@example.com',
    });
  });
});
