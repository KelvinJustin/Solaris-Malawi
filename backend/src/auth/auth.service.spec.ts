import { Test, type TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import { EmailService } from '../email/email.service.js';

const OTP_SECRET = 'test-otp-secret';

function hashOtp(merchantId: string, code: string): string {
  return createHmac('sha256', OTP_SECRET)
    .update(`${merchantId}:${code}`)
    .digest('hex');
}

describe('AuthService', () => {
  let service: AuthService;
  let passwordHash: string;

  let database: {
    merchant: {
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    merchantProfile: {
      update: ReturnType<typeof vi.fn>;
    };
    otpChallenge: {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    revokedToken: {
      create: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };

  let emailService: {
    sendVerificationCode: ReturnType<typeof vi.fn>;
    sendLoginCode: ReturnType<typeof vi.fn>;
  };

  let jwtService: {
    signAsync: ReturnType<typeof vi.fn>;
  };

  const password = 'Correct-password-123!';
  const merchantId = 'merchant-uuid-1';
  const email = 'merchant@example.com';
  const phone = '+265991234567';

  const verifiedMerchant = () => ({
    id: merchantId,
    name: 'Test Merchant',
    email,
    phone,
    passwordHash,
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    profile: {
      accountStatus: 'PENDING_SUBMISSION',
    },
  });

  const makeChallenge = (
    code: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id: 'otp-challenge-1',
    merchantId,
    purpose: 'LOGIN',
    codeHash: hashOtp(merchantId, code),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    attempts: 0,
    consumedAt: null,
    createdAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    // Use real bcrypt so password checks exercise the actual hash comparison.
    passwordHash = await bcrypt.hash(password, 4);

    const transactionMocks = {
      merchant: {
        create: vi.fn().mockResolvedValue({
          id: merchantId,
          name: 'Test Merchant',
          email,
          phone,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      otpChallenge: {
        create: vi.fn().mockResolvedValue({
          id: 'email-otp-1',
        }),
      },
      merchantProfile: {
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
    };

    database = {
      merchant: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
      merchantProfile: {
        update: vi.fn().mockResolvedValue({}),
      },
      otpChallenge: {
        findFirst: vi.fn(),
        create: vi.fn().mockResolvedValue({
          id: 'otp-challenge-1',
        }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      revokedToken: {
        create: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn(async (callback: (tx: typeof transactionMocks) => unknown) =>
        callback(transactionMocks),
      ),
    };

    emailService = {
      sendVerificationCode: vi.fn().mockResolvedValue(undefined),
      sendLoginCode: vi.fn().mockResolvedValue(undefined),
    };

    jwtService = {
      signAsync: vi.fn().mockResolvedValue('test-jwt'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: DatabaseService,
          useValue: database,
        },
        {
          provide: JwtService,
          useValue: jwtService,
        },
        {
          provide: EmailService,
          useValue: emailService,
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: vi.fn().mockReturnValue(OTP_SECRET),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ------------------------------------------------------------
  // REGISTRATION
  // ------------------------------------------------------------

  describe('register', () => {
    const registrationDto = {
      name: 'Test Merchant',
      email,
      password,
      phone,
    };

    it('creates the merchant, profile, and email verification challenge', async () => {
      database.merchant.findFirst.mockResolvedValue(null);

      const result = await service.register(registrationDto);

      expect(result).toEqual({
        message: 'Verification email sent',
        email,
      });

      expect(database.merchant.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ email }, { phone }],
        },
      });

      expect(database.$transaction).toHaveBeenCalledOnce();

      expect(emailService.sendVerificationCode).toHaveBeenCalledWith(
        email,
        expect.stringMatching(/^\d{6}$/),
      );
    });

    it('rejects a duplicate email or phone number', async () => {
      database.merchant.findFirst.mockResolvedValue({
        id: merchantId,
      });

      await expect(
        service.register(registrationDto),
      ).rejects.toThrow(ConflictException);

      expect(database.$transaction).not.toHaveBeenCalled();
      expect(emailService.sendVerificationCode).not.toHaveBeenCalled();
    });

    it('reports email delivery failure after creating the account', async () => {
      database.merchant.findFirst.mockResolvedValue(null);

      emailService.sendVerificationCode.mockRejectedValue(
        new Error('SMTP unavailable'),
      );

      await expect(
        service.register(registrationDto),
      ).rejects.toThrow(ServiceUnavailableException);

      // The service intentionally does not roll back registration
      // merely because the external email provider failed.
      expect(database.$transaction).toHaveBeenCalledOnce();
    });
  });

  // ------------------------------------------------------------
  // LOGIN — FIRST FACTOR
  // ------------------------------------------------------------

  describe('login', () => {
    it('rejects an unknown email', async () => {
      database.merchant.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'unknown@example.com', password }),
      ).rejects.toThrow(UnauthorizedException);

      expect(emailService.sendLoginCode).not.toHaveBeenCalled();
      expect(database.otpChallenge.create).not.toHaveBeenCalled();
    });

    it('rejects an incorrect password', async () => {
      database.merchant.findUnique.mockResolvedValue(verifiedMerchant());

      await expect(
        service.login({ email, password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(emailService.sendLoginCode).not.toHaveBeenCalled();
    });

    it('rejects a deleted merchant', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...verifiedMerchant(),
        deletedAt: new Date(),
      });

      await expect(
        service.login({ email, password }),
      ).rejects.toThrow(UnauthorizedException);

      expect(emailService.sendLoginCode).not.toHaveBeenCalled();
    });

    it('rejects a suspended merchant', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...verifiedMerchant(),
        profile: { accountStatus: 'SUSPENDED' },
      });

      await expect(
        service.login({ email, password }),
      ).rejects.toThrow(UnauthorizedException);

      expect(emailService.sendLoginCode).not.toHaveBeenCalled();
    });

    it('rejects an unverified email', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...verifiedMerchant(),
        emailVerifiedAt: null,
      });

      await expect(
        service.login({ email, password }),
      ).rejects.toThrow(UnauthorizedException);

      expect(emailService.sendLoginCode).not.toHaveBeenCalled();
    });

    it('creates a login challenge and emails the OTP', async () => {
      database.merchant.findUnique.mockResolvedValue(verifiedMerchant());

      const result = await service.login({ email, password });

      expect(result).toEqual({
        message: 'Login verification code sent',
        email,
      });

      expect(database.otpChallenge.updateMany).toHaveBeenCalledWith({
        where: {
          merchantId,
          purpose: 'LOGIN',
          consumedAt: null,
        },
        data: {
          consumedAt: expect.any(Date),
        },
      });

      expect(database.otpChallenge.create).toHaveBeenCalledWith({
        data: {
          merchantId,
          purpose: 'LOGIN',
          codeHash: expect.any(String),
          expiresAt: expect.any(Date),
        },
      });

      expect(emailService.sendLoginCode).toHaveBeenCalledWith(
        email,
        expect.stringMatching(/^\d{6}$/)
      );
    });

    it('consumes the newly created challenge if email delivery fails', async () => {
      database.merchant.findUnique.mockResolvedValue(verifiedMerchant());

      emailService.sendLoginCode.mockRejectedValue(
        new Error('SMTP unavailable'),
      );

      await expect(
        service.login({ email, password }),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(database.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'otp-challenge-1' },
        data: { consumedAt: expect.any(Date) },
      });
    });
  });

  // ------------------------------------------------------------
  // LOGIN — SECOND FACTOR
  // ------------------------------------------------------------

  describe('verifyLogin', () => {
    it('rejects an unknown merchant', async () => {
      database.merchant.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyLogin({ email, code: '123456' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(database.otpChallenge.findFirst).not.toHaveBeenCalled();
    });

    it('rejects an unverified merchant', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...verifiedMerchant(),
        emailVerifiedAt: null,
      });

      await expect(
        service.verifyLogin({ email, code: '123456' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a missing challenge', async () => {
      database.merchant.findUnique.mockResolvedValue(verifiedMerchant());
      database.otpChallenge.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyLogin({ email, code: '123456' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired challenge', async () => {
      database.merchant.findUnique.mockResolvedValue(verifiedMerchant());
      database.otpChallenge.findFirst.mockResolvedValue(
        makeChallenge('123456', {
          expiresAt: new Date(Date.now() - 1000),
        }),
      );

      await expect(
        service.verifyLogin({ email, code: '123456' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a challenge that has reached the attempt limit', async () => {
      database.merchant.findUnique.mockResolvedValue(verifiedMerchant());
      database.otpChallenge.findFirst.mockResolvedValue(
        makeChallenge('123456', { attempts: 5 }),
      );

      await expect(
        service.verifyLogin({ email, code: '123456' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('increments attempts and rejects an incorrect OTP', async () => {
      database.merchant.findUnique.mockResolvedValue(verifiedMerchant());
      database.otpChallenge.findFirst.mockResolvedValue(
        makeChallenge('654321'),
      );

      await expect(
        service.verifyLogin({ email, code: '123456' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(database.otpChallenge.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'otp-challenge-1',
          consumedAt: null,
          attempts: { lt: 5 },
          expiresAt: { gt: expect.any(Date) },
        },
        data: {
          attempts: { increment: 1 },
        },
      });

      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('consumes a valid OTP and issues a JWT', async () => {
      database.merchant.findUnique.mockResolvedValue(verifiedMerchant());
      database.otpChallenge.findFirst.mockResolvedValue(
        makeChallenge('123456'),
      );

      const result = await service.verifyLogin({
        email,
        code: '123456',
      });

      expect(database.otpChallenge.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'otp-challenge-1',
          codeHash: hashOtp(merchantId, '123456'),
          consumedAt: null,
          attempts: { lt: 5 },
          expiresAt: { gt: expect.any(Date) },
        },
        data: {
          consumedAt: expect.any(Date),
        },
      });

      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: merchantId,
        email,
        jti: expect.any(String),
      });

      expect(result).toEqual({ accessToken: 'test-jwt' });
    });

    it('rejects an OTP consumed by another request', async () => {
      database.merchant.findUnique.mockResolvedValue(verifiedMerchant());
      database.otpChallenge.findFirst.mockResolvedValue(
        makeChallenge('123456'),
      );
      database.otpChallenge.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.verifyLogin({ email, code: '123456' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------
  // EMAIL VERIFICATION
  // ------------------------------------------------------------

  describe('verifyEmail', () => {
    it('rejects an unknown merchant', async () => {
      database.merchant.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyEmail({ email, code: '123456' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an already verified merchant', async () => {
      database.merchant.findUnique.mockResolvedValue(verifiedMerchant());

      await expect(
        service.verifyEmail({ email, code: '123456' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(database.otpChallenge.findFirst).not.toHaveBeenCalled();
    });

    it('rejects a missing challenge', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...verifiedMerchant(),
        emailVerifiedAt: null,
      });
      database.otpChallenge.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyEmail({ email, code: '123456' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired challenge', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...verifiedMerchant(),
        emailVerifiedAt: null,
      });
      database.otpChallenge.findFirst.mockResolvedValue(
        makeChallenge('123456', {
          purpose: 'EMAIL_VERIFICATION',
          expiresAt: new Date(Date.now() - 1000),
        }),
      );

      await expect(
        service.verifyEmail({ email, code: '123456' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a challenge that has reached the attempt limit', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...verifiedMerchant(),
        emailVerifiedAt: null,
      });
      database.otpChallenge.findFirst.mockResolvedValue(
        makeChallenge('123456', {
          purpose: 'EMAIL_VERIFICATION',
          attempts: 5,
        }),
      );

      await expect(
        service.verifyEmail({ email, code: '123456' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('increments attempts and rejects an incorrect verification code', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...verifiedMerchant(),
        emailVerifiedAt: null,
      });
      database.otpChallenge.findFirst.mockResolvedValue(
        makeChallenge('654321', {
          purpose: 'EMAIL_VERIFICATION',
        }),
      );

      await expect(
        service.verifyEmail({ email, code: '123456' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(database.otpChallenge.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'otp-challenge-1',
          consumedAt: null,
          attempts: { lt: 5 },
          expiresAt: { gt: expect.any(Date) },
        },
        data: {
          attempts: { increment: 1 },
        },
      });
    });

    it('consumes a valid code, verifies the email and issues a JWT (auto-login)', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...verifiedMerchant(),
        emailVerifiedAt: null,
      });
      database.otpChallenge.findFirst.mockResolvedValue(
        makeChallenge('123456', {
          purpose: 'EMAIL_VERIFICATION',
        }),
      );

      const result = await service.verifyEmail({
        email,
        code: '123456',
      });

      expect(database.otpChallenge.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'otp-challenge-1',
          codeHash: hashOtp(merchantId, '123456'),
          consumedAt: null,
          attempts: { lt: 5 },
          expiresAt: { gt: expect.any(Date) },
        },
        data: {
          consumedAt: expect.any(Date),
        },
      });

      expect(database.merchant.update).toHaveBeenCalledWith({
        where: { id: merchantId },
        data: { emailVerifiedAt: expect.any(Date) },
      });

      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: merchantId,
        email,
        jti: expect.any(String),
      });

      expect(result).toEqual({
        message: 'Email verified successfully',
        accessToken: expect.any(String),
      });
    });

    it('rejects a deleted merchant without touching the challenge', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...verifiedMerchant(),
        emailVerifiedAt: null,
        deletedAt: new Date(),
      });

      await expect(
        service.verifyEmail({ email, code: '123456' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(database.otpChallenge.findFirst).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('does not verify the email if atomic OTP consumption fails', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...verifiedMerchant(),
        emailVerifiedAt: null,
      });
      database.otpChallenge.findFirst.mockResolvedValue(
        makeChallenge('123456', {
          purpose: 'EMAIL_VERIFICATION',
        }),
      );
      database.otpChallenge.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.verifyEmail({ email, code: '123456' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(database.merchant.update).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------
  // LOGOUT
  // ------------------------------------------------------------

  // ------------------------------------------------------------
  // EMAIL VERIFICATION — RESEND
  // ------------------------------------------------------------

  describe('resendVerification', () => {
    const genericMessage =
      'If that account is awaiting verification, a new code has been sent';

    const unverifiedMerchant = () => ({
      ...verifiedMerchant(),
      emailVerifiedAt: null,
    });

    it('returns the generic response for an unknown email without sending anything', async () => {
      database.merchant.findUnique.mockResolvedValue(null);

      await expect(service.resendVerification({ email })).resolves.toEqual({
        message: genericMessage,
      });

      expect(database.otpChallenge.create).not.toHaveBeenCalled();
      expect(emailService.sendVerificationCode).not.toHaveBeenCalled();
    });

    it('returns the generic response for an already verified merchant without sending anything', async () => {
      database.merchant.findUnique.mockResolvedValue(verifiedMerchant());

      await expect(service.resendVerification({ email })).resolves.toEqual({
        message: genericMessage,
      });

      expect(database.otpChallenge.create).not.toHaveBeenCalled();
      expect(emailService.sendVerificationCode).not.toHaveBeenCalled();
    });

    it('does not send another email inside the cooldown window', async () => {
      database.merchant.findUnique.mockResolvedValue(unverifiedMerchant());
      database.otpChallenge.findFirst.mockResolvedValue(
        makeChallenge('123456', {
          purpose: 'EMAIL_VERIFICATION',
          createdAt: new Date(Date.now() - 10 * 1000),
        }),
      );

      await expect(service.resendVerification({ email })).resolves.toEqual({
        message: genericMessage,
      });

      expect(database.otpChallenge.create).not.toHaveBeenCalled();
      expect(emailService.sendVerificationCode).not.toHaveBeenCalled();
    });

    it('invalidates older codes, stores a new hashed challenge and emails the code', async () => {
      database.merchant.findUnique.mockResolvedValue(unverifiedMerchant());
      database.otpChallenge.findFirst.mockResolvedValue(
        makeChallenge('123456', {
          purpose: 'EMAIL_VERIFICATION',
          createdAt: new Date(Date.now() - 5 * 60 * 1000),
        }),
      );

      await expect(service.resendVerification({ email })).resolves.toEqual({
        message: genericMessage,
      });

      expect(database.otpChallenge.updateMany).toHaveBeenCalledWith({
        where: {
          merchantId,
          purpose: 'EMAIL_VERIFICATION',
          consumedAt: null,
        },
        data: { consumedAt: expect.any(Date) },
      });

      expect(emailService.sendVerificationCode).toHaveBeenCalledWith(
        email,
        expect.stringMatching(/^\d{6}$/),
      );

      // The plain code is emailed, only its HMAC is stored.
      const sentCode = emailService.sendVerificationCode.mock.calls[0]![1] as string;
      expect(database.otpChallenge.create).toHaveBeenCalledWith({
        data: {
          merchantId,
          purpose: 'EMAIL_VERIFICATION',
          codeHash: hashOtp(merchantId, sentCode),
          expiresAt: expect.any(Date),
        },
      });
    });

    it('consumes the new challenge and reports failure if email delivery fails', async () => {
      database.merchant.findUnique.mockResolvedValue(unverifiedMerchant());
      database.otpChallenge.findFirst.mockResolvedValue(null);
      emailService.sendVerificationCode.mockRejectedValue(
        new Error('SMTP unavailable'),
      );

      await expect(
        service.resendVerification({ email }),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(database.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'otp-challenge-1' },
        data: { consumedAt: expect.any(Date) },
      });
    });
  });

  describe('logout', () => {
    it('stores the token ID and expiry for revocation', async () => {
      const user = {
        userId: merchantId,
        jti: 'token-id-123',
        exp: 1_800_000_000,
      };

      const result = await service.logout(user);

      expect(database.revokedToken.create).toHaveBeenCalledWith({
        data: {
          jti: user.jti,
          merchantId,
          expiresAt: new Date(user.exp * 1000),
        },
      });

      expect(result).toEqual({
        message: 'Logged out successfully',
      });
    });
  });

  // ------------------------------------------------------------
  // ACCOUNT DELETION
  // ------------------------------------------------------------

  describe('deleteAccount', () => {
    it('rejects an account that does not exist', async () => {
      database.merchant.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteAccount(merchantId),
      ).rejects.toThrow(UnauthorizedException);

      expect(database.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an account that is already deleted', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...verifiedMerchant(),
        deletedAt: new Date(),
        profile: { accountStatus: 'SUSPENDED' },
      });

      await expect(
        service.deleteAccount(merchantId),
      ).rejects.toThrow(UnauthorizedException);

      expect(database.$transaction).not.toHaveBeenCalled();
    });

    it('soft-deletes the merchant and suspends the existing profile', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...verifiedMerchant(),
        profile: { accountStatus: 'PENDING_SUBMISSION' },
      });

      const result = await service.deleteAccount(merchantId);

      expect(database.$transaction).toHaveBeenCalledOnce();
      expect(result).toEqual({
        message: 'Account deleted successfully',
      });
    });

    it('soft-deletes the merchant when no profile exists', async () => {
      database.merchant.findUnique.mockResolvedValue({
        ...verifiedMerchant(),
        profile: null,
      });

      await expect(
        service.deleteAccount(merchantId),
      ).resolves.toEqual({
        message: 'Account deleted successfully',
      });

      expect(database.$transaction).toHaveBeenCalledOnce();
    });
  });
});