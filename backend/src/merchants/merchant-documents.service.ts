
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DocumentType } from '../generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { R2StorageService } from '../storage/r2-storage.service.js';
import { RequestDocumentUploadDto } from './dto/request-document-upload.dto.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
]);

@Injectable()
export class MerchantDocumentsService {
    constructor(
        private readonly database: DatabaseService,
        private readonly storage: R2StorageService,
    ) { }

    /**
     * Creates a signed upload intent so a merchant can place a document into the
     * document bucket without exposing the storage credentials to the browser.
     */
    async requestUpload(
        merchantId: string,
        dto: RequestDocumentUploadDto,
    ) {
        if (!ALLOWED_TYPES.has(dto.contentType)) {
            throw new BadRequestException('Unsupported document format');
        }

        const profile = await this.database.merchantProfile.findUnique({
            where: { merchantId },
            select: { id: true, accountStatus: true },
        });

        if (!profile) {
            throw new NotFoundException('Merchant profile not found');
        }

        // Initial onboarding and resubmission after rejection.
        // Admin-requested corrections will be handled separately.
        if (
            !['PENDING_SUBMISSION', 'REJECTED'].includes(profile.accountStatus)
        ) {
            throw new BadRequestException(
                'Documents cannot be uploaded at this stage',
            );
        }

        const uploadId = randomUUID();
        const objectKey = `kyc/${profile.id}/${randomUUID()}`;
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        await this.database.merchantDocumentUpload.create({
            data: {
                id: uploadId,
                profileId: profile.id,
                type: dto.type,
                objectKey,
                expectedMimeType: dto.contentType,
                expiresAt,
            },
        });

        const uploadUrl = await this.storage.createUploadUrl(
            objectKey,
            dto.contentType,
        );

        return {
            uploadId,
            uploadUrl,
            method: 'PUT',
            contentType: dto.contentType,
            expiresAt,
            maxFileSizeBytes: MAX_FILE_SIZE,
        };
    }

    /**
     * Finalizes a pending upload after the document is validated and persisted.
     *
     * The service verifies size, mime type, and file signature before the new
     * document replaces the older version for that document type.
     */
    async completeUpload(merchantId: string, uploadId: string) {
        const profile = await this.database.merchantProfile.findUnique({
            where: { merchantId },
            select: { id: true, accountStatus: true },
        });

        if (!profile) {
            throw new NotFoundException('Merchant profile not found');
        }

        const intent = await this.database.merchantDocumentUpload.findFirst({
            where: {
                id: uploadId,
                profileId: profile.id,
                completedAt: null,
                expiresAt: { gt: new Date() },
            },
        });

        if (!intent) {
            throw new BadRequestException(
                'Upload request is invalid, expired, or already completed',
            );
        }

        const metadata = await this.storage.getObjectMetadata(intent.objectKey);
        const size = metadata.ContentLength;

        if (!Number.isInteger(size) || size! <= 0 || size! > MAX_FILE_SIZE) {
            await this.storage.deleteObject(intent.objectKey);
            throw new BadRequestException(
                'File must be larger than zero and no bigger than 10 MiB',
            );
        }

        if (metadata.ContentType !== intent.expectedMimeType) {
            await this.storage.deleteObject(intent.objectKey);
            throw new BadRequestException('Uploaded content type does not match');
        }

        const signature = await this.storage.readFileSignature(intent.objectKey);

        if (!this.hasValidSignature(intent.expectedMimeType, signature)) {
            await this.storage.deleteObject(intent.objectKey);
            throw new BadRequestException(
                'The file contents do not match the declared format',
            );
        }

        // Do not replace the old version until the new file has passed checks.
        const result = await this.database.$transaction(async (tx) => {
            const currentIntent = await tx.merchantDocumentUpload.findFirst({
                where: {
                    id: uploadId,
                    profileId: profile.id,
                    completedAt: null,
                    expiresAt: { gt: new Date() },
                },
            });

            if (!currentIntent) {
                throw new BadRequestException('Upload has already been completed');
            }

            const document = await tx.merchantDocument.create({
                data: {
                    profileId: profile.id,
                    type: currentIntent.type,
                    status: 'PENDING',
                    // Internal identifier only; never send this to the browser as a URL.
                    fileUrl: `r2://${currentIntent.objectKey}`,
                    fileKey: currentIntent.objectKey,
                    mimeType: currentIntent.expectedMimeType,
                    fileSizeBytes: size!,
                },
                select: {
                    id: true,
                    type: true,
                    status: true,
                    mimeType: true,
                    fileSizeBytes: true,
                    uploadedAt: true,
                },
            });

            await tx.merchantDocument.updateMany({
                where: {
                    profileId: profile.id,
                    type: currentIntent.type,
                    id: { not: document.id },
                    supersededAt: null,
                    supersededByDocumentId: null,
                },
                data: {
                    supersededAt: new Date(),
                    supersededByDocumentId: document.id,
                },
            });

            await tx.merchantDocumentUpload.update({
                where: { id: currentIntent.id },
                data: { completedAt: new Date() },
            });

            return document;
        });

        return result;
    }

    /**
     * Validates the file magic bytes for the supported document types.
     *
     * This prevents a browser from uploading a PDF with a JPEG extension or vice
     * versa, which would otherwise cause confusing downstream review issues.
     */
    private hasValidSignature(
        mimeType: string,
        bytes: Uint8Array,
    ): boolean {
        const startsWith = (...expected: number[]) =>
            expected.every((byte, index) => bytes[index] === byte);

        switch (mimeType) {
            case 'application/pdf':
                return startsWith(0x25, 0x50, 0x44, 0x46, 0x2d); // %PDF-

            case 'image/png':
                return startsWith(
                    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
                );

            case 'image/jpeg':
                return startsWith(0xff, 0xd8, 0xff);

            default:
                return false;
        }
    }

    /**
     * Lists the uploaded documents for a merchant profile in review order.
     */
    async listDocuments(merchantId: string) {
        const profile = await this.database.merchantProfile.findUnique({
            where: { merchantId },
            select: { id: true },
        });

        if (!profile) {
            throw new NotFoundException('Merchant profile not found');
        }

        const documents = await this.database.merchantDocument.findMany({
            where: {
                profileId: profile.id,
            },
            orderBy: {
                uploadedAt: 'desc',
            },
            select: {
                id: true,
                type: true,
                status: true,
                mimeType: true,
                fileSizeBytes: true,
                uploadedAt: true,
                updatedAt: true,
                rejectionNote: true,
                reviewedAt: true,
                supersededAt: true,
                supersededByDocumentId: true,
            },
        });

        return documents.map((document) => ({
            ...document,
            isCurrent:
                document.supersededAt === null &&
                document.supersededByDocumentId === null,
        }));
    }

}
