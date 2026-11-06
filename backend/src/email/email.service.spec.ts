
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { EmailService } from './email.service.js';

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(),
  },
}));

describe('EmailService', () => {
  let service: EmailService;

  const mockTransporter = {
    verify: vi.fn(),
    sendMail: vi.fn(),
  };

  const configValues: Record<string, string> = {
    SMTP_SERVER: '127.0.0.1',
    SMTP_PORT: '1025',
    SMTP_FROM: 'Solaris Malawi <no-reply@solaris.local>',
    NODE_ENV: 'development',
  };

  const mockConfigService = {
    getOrThrow: vi.fn((key: string) => {
      const value = configValues[key];

      if (value === undefined) {
        throw new Error(`Missing configuration: ${key}`);
      }

      return value;
    }),
    get: vi.fn((key: string) => configValues[key]),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    vi.mocked(nodemailer.createTransport).mockReturnValue(
      mockTransporter as never,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get(EmailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should configure Mailpit without authentication', () => {
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 1025,
      secure: false,
      ignoreTLS: true,
    });
  });

  it('should verify the SMTP connection on initialization', async () => {
    mockTransporter.verify.mockImplementation(
      (callback: (error: Error | null) => void) => callback(null),
    );

    await service.onModuleInit();

    expect(mockTransporter.verify).toHaveBeenCalled();
  });

  it('should send a verification email containing the OTP', async () => {
    mockTransporter.sendMail.mockResolvedValue({
      messageId: 'test-message-id',
    });

    await service.sendVerificationCode('jane@example.com', '123456');

    expect(mockTransporter.sendMail).toHaveBeenCalledWith({
      from: 'Solaris Malawi <no-reply@solaris.local>',
      to: 'jane@example.com',
      subject: 'Verify your Solaris email',
      text: `Your Solaris verification code is 123456.

This code expires in 10 minutes.

If you did not request this code, you can ignore this email.`,
    });
  });

  it('should send a login verification email', async () => {
    mockTransporter.sendMail.mockResolvedValue({
      messageId: 'login-message-id',
    });

    await service.sendLoginCode('jane@example.com', '654321');

    expect(mockTransporter.sendMail).toHaveBeenCalledWith({
      from: 'Solaris Malawi <no-reply@solaris.local>',
      to: 'jane@example.com',
      subject: 'Your Solaris login verification code',
      text: `Your Solaris login code is 654321.

This code expires in 10 minutes.
If you did not attempt to log in, secure your account.`,
    });
  });

  it('should reject an invalid SMTP port', () => {
    const invalidConfig = {
      ...mockConfigService,
      getOrThrow: vi.fn((key: string) => {
        if (key === 'SMTP_PORT') return 'invalid';
        return configValues[key];
      }),
    };

    expect(
      () =>
        new EmailService(
          invalidConfig as unknown as ConfigService,
        ),
    ).toThrow('SMTP_PORT must be a valid TCP port');
  });
});
