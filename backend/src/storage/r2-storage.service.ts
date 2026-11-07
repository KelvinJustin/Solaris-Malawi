import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';

import {
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class R2StorageService implements OnModuleInit, OnModuleDestroy {

    private readonly logger = new Logger(R2StorageService.name);
    private readonly client: S3Client;
    private readonly bucket: string;

    /**
     * Builds the object-storage client used for Cloudflare R2 or a local S3-compatible
     * endpoint.
     *
     * The bucket and credentials are validated at construction time so the service
     * fails early when the environment is misconfigured.
     */
    constructor(config: ConfigService) {
        const endpoint = config.get<string>('R2_ENDPOINT');

        const isLocalStorage = Boolean(endpoint);

        this.bucket = config.getOrThrow<string>('R2_BUCKET_NAME');

        const region = config.get<string>('R2_REGION') ?? 'auto';

        this.client = new S3Client({
            region,
            requestChecksumCalculation: 'WHEN_REQUIRED',

            ...(isLocalStorage
                ? {
                    endpoint,
                    forcePathStyle:
                        config.get<boolean>('R2_FORCE_PATH_STYLE') ?? true,
                }
                : {
                    endpoint: `https://${config.getOrThrow<string>('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
                    forcePathStyle: true,
                }),

            credentials: {
                accessKeyId: config.getOrThrow<string>('R2_ACCESS_KEY_ID'),
                secretAccessKey: config.getOrThrow<string>('R2_SECRET_ACCESS_KEY'),
            },
        });

        this.logger.log(
            `Object storage initialized (${isLocalStorage ? 'LOCAL S3' : 'CLOUDFLARE R2'})`,
        );
    }


    /**
     * Wraps storage operations with consistent logging and error reporting.
     *
     * This helps operators distinguish configuration issues from transient network
     * failures without changing the service's external contract.
     */
    private async logged<T>(
        operation: string,
        action: () => Promise<T>,
    ): Promise<T> {
        const startedAt = Date.now();

        try {
            const result = await action();
            this.logger.log(
                `${operation} succeeded (${Date.now() - startedAt}ms)`,
            );
            return result;
        } catch (error: unknown) {
            const details =
                typeof error === 'object' && error !== null
                    ? (error as {
                        name?: string;
                        Code?: string;
                        $metadata?: { httpStatusCode?: number };
                    })
                    : {};

            this.logger.error(
                `${operation} failed (${Date.now() - startedAt}ms): ` +
                `code=${details.Code ?? details.name ?? 'Unknown'}, ` +
                `httpStatus=${details.$metadata?.httpStatusCode ?? 'unknown'}`,
            );

            throw error;
        }
    }

    /**
     * Generates a short-lived upload URL for a document or proof file.
     */
    async createUploadUrl(
        key: string,
        contentType: string,
    ): Promise<string> {
        return this.logged('createUploadUrl', async () => {
            const command = new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                ContentType: contentType,
            });

            return getSignedUrl(this.client, command, {
                expiresIn: 300,
            });
        });
    }


    /**
     * Generates a signed download URL for a stored object.
     */
    async createDownloadUrl(
        objectKey: string,
        expiresInSeconds = 300,
    ): Promise<string> {
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: objectKey,
        });

        return getSignedUrl(this.client, command, {
            expiresIn: expiresInSeconds,
        });
    }


    /**
     * Creates a preview URL with inline disposition so browsers can render the
     * file without forcing an immediate download.
     */
    async createPreviewUrl(key: string): Promise<string> {
        return this.logged('createPreviewUrl', async () => {
            const command = new GetObjectCommand({
                Bucket: this.bucket,
                Key: key,
                ResponseContentDisposition: 'inline',
            });

            return getSignedUrl(this.client, command, {
                expiresIn: 300,
            });
        });
    }

    /**
     * Reads the metadata for an object in storage without downloading the full
     * body.
     */
    async getObjectMetadata(key: string) {
        return this.logged('getObjectMetadata', () =>
            this.client.send(
                new HeadObjectCommand({
                    Bucket: this.bucket,
                    Key: key,
                }),
            ),
        );
    }

    /**
     * Reads the beginning of a file to validate its MIME signature before it is
     * accepted as a document upload.
     */
    async readFileSignature(key: string): Promise<Uint8Array> {
        return this.logged('readFileSignature', async () => {
            const response = await this.client.send(
                new GetObjectCommand({
                    Bucket: this.bucket,
                    Key: key,
                    Range: 'bytes=0-15',
                }),
            );

            if (!response.Body) {
                throw new Error('Uploaded object has no readable body');
            }

            return response.Body.transformToByteArray();
        });
    }

    /**
     * Deletes a file from the bucket when an upload is invalid or a document is
     * no longer needed.
     */
    async deleteObject(key: string): Promise<void> {
        return this.logged('deleteObject', async () => {
            await this.client.send(
                new DeleteObjectCommand({
                    Bucket: this.bucket,
                    Key: key,
                }),
            );
        });
    }

    /**
     * Verifies that the configured bucket is reachable as soon as the module is
     * created.
     */
    async onModuleInit(): Promise<void> {
        this.logger.log('Checking object storage connection...');

        try {
            await this.client.send(
                new HeadBucketCommand({
                    Bucket: this.bucket,
                }),
            );

            this.logger.log('Object storage connection established successfully.');
            this.logger.log(`Storage bucket verified: ${this.bucket}`);
        } catch (error: unknown) {
            const details =
                typeof error === 'object' && error !== null
                    ? (error as {
                        name?: string;
                        Code?: string;
                        $metadata?: { httpStatusCode?: number };
                    })
                    : {};

            this.logger.error(
                `Object storage connection failed: ${details.Code ?? details.name ?? 'Unknown error'
                } (HTTP ${details.$metadata?.httpStatusCode ?? 'unknown'})`,
            );

            throw error;
        }
    }

    /**
     * Closes the underlying S3 client so the application can exit cleanly.
     */
    onModuleDestroy(): void {
        this.client.destroy();
        this.logger.log('R2 storage client closed');
    }
}
