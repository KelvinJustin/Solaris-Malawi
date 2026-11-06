import { Injectable, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

@Injectable()
export class CheckoutTokenService {
    private readonly encryptionKey: Buffer;

    constructor(private readonly configService: ConfigService) {
        const encodedKey = this.configService.get<string>('CHECKOUT_TOKEN_ENCRYPTION_KEY');

        if (!encodedKey) {
            throw new InternalServerErrorException('CHECKOUT_TOKEN_ENCRYPTION_KEY is not configured');
        }

        try {
            const key = Buffer.from(encodedKey, 'base64');
            if (key.length !== 32) {
                throw new Error();
            }
            this.encryptionKey = key;
        } catch {
            throw new InternalServerErrorException(
                'CHECKOUT_TOKEN_ENCRYPTION_KEY must be a valid Base64-encoded 32-byte key',
            );
        }
    }

    createToken(): {
        token: string;
        tokenHash: string;
        tokenEncrypted: string;
    } {
        const token = randomBytes(32).toString('base64url');

        return {
            token,
            tokenHash: this.hashToken(token),
            tokenEncrypted: this.encryptToken(token),
        };
    }

    hashToken(token: string): string {
        return createHash('sha256').update(token, 'utf8').digest('hex');
    }

    private encryptToken(token: string): string {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);

        const ciphertext = Buffer.concat([
            cipher.update(token, 'utf8'),
            cipher.final(),
        ]);

        const authenticationTag = cipher.getAuthTag();

        return [
            'v1',
            iv.toString('base64url'),
            authenticationTag.toString('base64url'),
            ciphertext.toString('base64url'),
        ].join('.');
    }

    decryptToken(encryptedToken: string): string {
        try {
            const parts = encryptedToken.split('.');

            if (parts.length !== 4 || parts[0] !== 'v1') {
                throw new BadRequestException('Invalid or unsupported encrypted checkout token');
            }

            const [, encodedIv, encodedTag, encodedCiphertext] = parts;

            const iv = Buffer.from(encodedIv, 'base64url');
            const authenticationTag = Buffer.from(encodedTag, 'base64url');
            const ciphertext = Buffer.from(encodedCiphertext, 'base64url');

            if (iv.length !== 12 || authenticationTag.length !== 16) {
                throw new BadRequestException('Invalid encrypted checkout token format');
            }

            const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
            decipher.setAuthTag(authenticationTag);

            return Buffer.concat([
                decipher.update(ciphertext),
                decipher.final(),
            ]).toString('utf8');
        } catch (error) {
            if (error instanceof BadRequestException) {
                throw error;
            }
            throw new BadRequestException('Could not decrypt checkout token');
        }
    }
}