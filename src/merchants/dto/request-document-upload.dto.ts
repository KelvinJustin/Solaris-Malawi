
import { IsEnum, IsIn } from 'class-validator';
import { DocumentType } from '../../generated/prisma/client.js';

export class RequestDocumentUploadDto {
    @IsEnum(DocumentType)
    type!: DocumentType;

    @IsIn(['application/pdf', 'image/jpeg', 'image/png'])
    contentType!: string;
}
