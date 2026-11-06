import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

@Injectable()
export class EmailService implements OnModuleInit {
    // Reusable SMTP transporter responsible for sending outgoing emails.
    private readonly transporter: Transporter;
    // Create a logger for database lifecycle events and errors.
    private readonly logger = new Logger(EmailService.name);

    constructor(private readonly configService: ConfigService) {
        // Configure the SMTP connection using environment-based settings.
        // getOrThrow() ensures the application fails if a required setting is missing.

        const smtpHost = this.configService.getOrThrow<string>('SMTP_SERVER');
        const smtpPort = Number(
            this.configService.getOrThrow<string>('SMTP_PORT'),
        );

        if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
            throw new Error('SMTP_PORT must be a valid TCP port');
        }

        const smtpUser = this.configService.get<string>('SMTP_USER');
        const smtpApiKey = this.configService.get<string>('SMTP_API_KEY');

        const isProduction =
            this.configService.get<string>('NODE_ENV') === 'production';

        this.transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,

            ...(smtpUser && smtpApiKey
                ? {
                    auth: {
                        user: smtpUser,
                        pass: smtpApiKey,
                    },
                }
                : {}),

            ...(!isProduction ? { ignoreTLS: true } : {}),
        });
    }

    // This lifecycle hook runs during startup and blocks the app from finishing 
    // until the promise resolves (ensuring SMTP connects first).
    async onModuleInit() {
        try {
            await new Promise((resolve, reject) => {
                this.transporter.verify((error) => {
                    if (error) {
                        return reject(error);
                    }
                    resolve(true);
                });
            });
            this.logger.log('SMTP connection established');
        } catch (error) {
            this.logger.error('SMTP connection failed:', error);
            // Optional: Uncomment the line below if you want the app to crash/abort 
            // startup completely when SMTP configuration is invalid.
            // throw error;
        }
    }

    // Generic email method shared by the verification and login email workflows.
    async sendEmail(to: string, subject: string, text: string) {
        return this.transporter.sendMail({
            // Sender address configured for the Solaris email account.
            from: this.configService.getOrThrow<string>('SMTP_FROM'),
            to,
            subject,
            text,
        });
    }

    // Send a one-time code to verify ownership of a merchant's email address.
    async sendVerificationCode(to: string, code: string) {
        return this.sendEmail(
            to,
            'Verify your Solaris email',
            `Your Solaris verification code is ${code}.

This code expires in 10 minutes.

If you did not request this code, you can ignore this email.`,
        );
    }

    // Send a one-time code as the second authentication step during login.
    async sendLoginCode(to: string, code: string) {
        return this.sendEmail(
            to,
            'Your Solaris login verification code',
            `Your Solaris login code is ${code}.

This code expires in 10 minutes.
If you did not attempt to log in, secure your account.`,
        );
    }
}