import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import { DatabaseService } from '../database/database.service.js';
import { EmailService } from '../email/email.service.js';

import { LoginAuthDto } from './dto/login-auth.dto.js';
import { RegisterAuthDto } from './dto/register-auth.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { VerifyLoginDto } from './dto/verify-login.dto.js';
import { ResendVerificationDto } from './dto/resend-verification.dto.js';
import { UpdateAuthDto } from './dto/update-auth.dto.js';
import { resolvePasswordHashCost } from '../password.js';

// Minimum gap between verification emails for the same account.
const RESEND_COOLDOWN_MS = 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) { }

  // ============================================================
  // SHARED OTP UTILITIES
  // ============================================================

  private hashOtp(merchantId: string, code: string): string {
    return createHmac(
      'sha256',
      this.configService.getOrThrow<string>('OTP_SECRET'),
    )
      .update(`${merchantId}:${code}`)
      .digest('hex');
  }

  // ============================================================
  // REGISTRATION
  // ============================================================

  async register(registerAuthDto: RegisterAuthDto) {
    const { name, email, password, phone } = registerAuthDto;

    const existingUser = await this.databaseService.merchant.findFirst({
      where: { OR: [{ email }, { phone }] },
    });

    if (existingUser) {
      throw new ConflictException('Email or phone number is already registered');
    }

    const hashedPassword = await bcrypt.hash(
      password,
      resolvePasswordHashCost(),
    );

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const user = await this.databaseService.$transaction(async (tx) => {
      const created = await tx.merchant.create({
        data: { name, email, passwordHash: hashedPassword, phone },
      });

      await tx.otpChallenge.create({
        data: {
          merchantId: created.id,
          purpose: 'EMAIL_VERIFICATION',
          codeHash: this.hashOtp(created.id, code),
          expiresAt,
        },
      });

      await tx.merchantProfile.create({
        data: {
          merchantId: created.id,
          businessName: '',
          businessType: 'INDIVIDUAL',
          accountStatus: 'PENDING_SUBMISSION',
        },
      });

      return created;
    });

    // Email is sent OUTSIDE the transaction so a failure doesn't roll back the account
    try {
      await this.emailService.sendVerificationCode(email, code);
    } catch {
      throw new ServiceUnavailableException(
        'Registration succeeded but we could not send your verification ' +
        'email. Please try again.',
      );
    }

    return { message: 'Verification email sent', email: user.email };
  }
  // ============================================================
  // LOGIN — FIRST FACTOR
  // ============================================================

  async login(loginAuthDto: LoginAuthDto) {
    const { email, password } = loginAuthDto;


    const user = await this.databaseService.merchant.findUnique({
      where: { email },
      include: {
        profile: {
          select: {
            accountStatus: true,
          },
        },
      },
    });


    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }


    if (
      user.deletedAt ||
      user.profile?.accountStatus === 'SUSPENDED'
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }


    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException(
        'Please verify your email before logging in',
      );
    }

    await this.databaseService.otpChallenge.updateMany({
      where: {
        merchantId: user.id,
        purpose: 'LOGIN',
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    });

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const challenge = await this.databaseService.otpChallenge.create({
      data: {
        merchantId: user.id,
        purpose: 'LOGIN',
        codeHash: this.hashOtp(user.id, code),
        expiresAt,
      },
    });

    try {
      await this.emailService.sendLoginCode(user.email, code);
    } catch {
      await this.databaseService.otpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });

      throw new ServiceUnavailableException(
        'Unable to send the login verification code. Please try again.',
      );
    }

    return {
      message: 'Login verification code sent',
      email: user.email,
    };
  }

  // ============================================================
  // LOGIN — SECOND FACTOR
  // ============================================================

  async verifyLogin(dto: VerifyLoginDto) {
    const { email, code } = dto;

    const merchant = await this.databaseService.merchant.findUnique({
      where: { email },
    });

    if (!merchant || !merchant.emailVerifiedAt) {
      throw new UnauthorizedException(
        'Invalid or expired login verification code',
      );
    }

    const challenge = await this.databaseService.otpChallenge.findFirst({
      where: {
        merchantId: merchant.id,
        purpose: 'LOGIN',
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (
      !challenge ||
      challenge.expiresAt.getTime() <= Date.now() ||
      challenge.attempts >= 5
    ) {
      throw new UnauthorizedException(
        'Invalid or expired login verification code',
      );
    }

    const submittedHash = this.hashOtp(merchant.id, code);

    const matches = timingSafeEqual(
      Buffer.from(submittedHash, 'hex'),
      Buffer.from(challenge.codeHash, 'hex'),
    );

    if (!matches) {
      await this.databaseService.otpChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          attempts: { lt: 5 },
          expiresAt: { gt: new Date() },
        },
        data: { attempts: { increment: 1 } },
      });

      throw new UnauthorizedException(
        'Invalid or expired login verification code',
      );
    }

    const consumed = await this.databaseService.otpChallenge.updateMany({
      where: {
        id: challenge.id,
        codeHash: submittedHash,
        consumedAt: null,
        attempts: { lt: 5 },
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });

    if (consumed.count !== 1) {
      throw new UnauthorizedException(
        'Invalid or expired login verification code',
      );
    }

    const payload = {
      sub: merchant.id,
      email: merchant.email,
      jti: randomUUID(),
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),

    };
  }

  // ============================================================
  // EMAIL VERIFICATION (auto-login on success)
  // ============================================================

  // Registration flow: the merchant supplied their password at sign-up and
  // now proves they own the mailbox with the emailed code. A correct code
  // therefore completes sign-up AND starts the session, so the merchant lands
  // on their home page without a second password + OTP round trip.
  async verifyEmail(dto: VerifyEmailDto) {
  const { email, code } = dto;

  const merchant = await this.databaseService.merchant.findUnique({
    where: { email },
  });

  if (!merchant || merchant.deletedAt) {
    throw new UnauthorizedException(
      'Invalid or expired verification code',
    );
  }

  // Never issue an authentication token from email verification
  // when the account is already verified (that would let a replayed or
  // leaked code mint sessions for an account that finished sign-up).
  if (merchant.emailVerifiedAt) {
    throw new UnauthorizedException(
      'Invalid or expired verification code',
    );
  }

  const challenge = await this.databaseService.otpChallenge.findFirst({
    where: {
      merchantId: merchant.id,
      purpose: 'EMAIL_VERIFICATION',
      consumedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (
    !challenge ||
    challenge.expiresAt.getTime() <= Date.now() ||
    challenge.attempts >= 5
  ) {
    throw new UnauthorizedException(
      'Invalid or expired verification code',
    );
  }

  const submittedHash = this.hashOtp(merchant.id, code);

  const storedHash = Buffer.from(challenge.codeHash, 'hex');
  const candidateHash = Buffer.from(submittedHash, 'hex');

  // timingSafeEqual throws if buffer lengths differ.
  // A valid HMAC-SHA256 hash should always be 32 bytes.
  if (
    storedHash.length !== candidateHash.length ||
    !timingSafeEqual(candidateHash, storedHash)
  ) {
    await this.databaseService.otpChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        attempts: { lt: 5 },
        expiresAt: { gt: new Date() },
      },
      data: { attempts: { increment: 1 } },
    });

    throw new UnauthorizedException(
      'Invalid or expired verification code',
    );
  }

  // Consume the challenge atomically so it cannot be reused.
  const consumed = await this.databaseService.otpChallenge.updateMany({
    where: {
      id: challenge.id,
      codeHash: submittedHash,
      consumedAt: null,
      attempts: { lt: 5 },
      expiresAt: { gt: new Date() },
    },
    data: { consumedAt: new Date() },
  });

  if (consumed.count !== 1) {
    throw new UnauthorizedException(
      'Invalid or expired verification code',
    );
  }

  await this.databaseService.merchant.update({
    where: { id: merchant.id },
    data: { emailVerifiedAt: new Date() },
  });

  // The code was valid and single-use, so the session starts now.
  const payload = {
    sub: merchant.id,
    email: merchant.email,
    jti: randomUUID(),
  };

  return {
    message: 'Email verified successfully',
    accessToken: await this.jwtService.signAsync(payload),
  };
}

  // ============================================================
  // EMAIL VERIFICATION — RESEND
  // ============================================================

  // Issues a fresh verification code for an account that registered but has
  // not verified yet (code expired, locked after 5 attempts, or email lost).
  //
  // The response is intentionally identical whether or not the email exists,
  // is already verified, or is inside the cooldown, so this endpoint cannot
  // be used to discover which emails are registered.
  async resendVerification(dto: ResendVerificationDto) {
    const { email } = dto;
    const generic = {
      message:
        'If that account is awaiting verification, a new code has been sent',
    };

    const merchant = await this.databaseService.merchant.findUnique({
      where: { email },
    });

    if (!merchant || merchant.emailVerifiedAt || merchant.deletedAt) {
      return generic;
    }

    // Cooldown: at most one new code per minute per account.
    const latest = await this.databaseService.otpChallenge.findFirst({
      where: { merchantId: merchant.id, purpose: 'EMAIL_VERIFICATION' },
      orderBy: { createdAt: 'desc' },
    });

    if (
      latest &&
      Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS
    ) {
      return generic;
    }

    // Invalidate older codes so only the newest one can verify the account.
    await this.databaseService.otpChallenge.updateMany({
      where: {
        merchantId: merchant.id,
        purpose: 'EMAIL_VERIFICATION',
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    });

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const challenge = await this.databaseService.otpChallenge.create({
      data: {
        merchantId: merchant.id,
        purpose: 'EMAIL_VERIFICATION',
        codeHash: this.hashOtp(merchant.id, code),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    try {
      await this.emailService.sendVerificationCode(merchant.email, code);
    } catch {
      await this.databaseService.otpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });

      throw new ServiceUnavailableException(
        'Unable to send the verification email. Please try again.',
      );
    }

    return generic;
  }

  // ============================================================
  // LOGOUT
  // ============================================================

  async logout(user: {
    userId: string;
    jti: string;
    exp: number;
  }) {
    await this.databaseService.revokedToken.create({
      data: {
        jti: user.jti,
        merchantId: user.userId,
        expiresAt: new Date(user.exp * 1000),
      },
    });

    return { message: 'Logged out successfully' };
  }

  // ============================================================
  // PLACEHOLDERS
  // ============================================================

  update(id: number, updateAuthDto: UpdateAuthDto) {
    return `This action updates a #${id} auth`;
  }

  // Soft-delete the merchant account. We never hard-delete because
  // financial records, audit trails, and KYC documents must remain
  // intact for reconciliation. Setting deletedAt makes the account
  // unreachable without destroying any trace of it.
  //
  // We also suspend the profile so it cannot be approved or used
  // for payments even if someone finds a way to reference it.
  async deleteAccount(userId: string) {
    const merchant = await this.databaseService.merchant.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!merchant || merchant.deletedAt) {
      throw new UnauthorizedException('Account not found');
    }

    await this.databaseService.$transaction(async (tx) => {
      // Mark the merchant account as deleted.
      await tx.merchant.update({
        where: { id: userId },
        data: { deletedAt: new Date() },
      });

      // If a profile exists, suspend it so it can't be approved
      // or used for payouts. We don't delete it — it stays for
      // audit and financial reconciliation purposes.
      if (merchant.profile) {
        await tx.merchantProfile.update({
          where: { merchantId: userId },
          data: { accountStatus: 'SUSPENDED' },
        });
      }
    });

    return { message: 'Account deleted successfully' };
  }
}