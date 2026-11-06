import {
    IsDateString,
    IsEnum,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    Min,
} from 'class-validator';

import { PaymentProvider } from '../../generated/prisma/enums.js';

export enum ProviderCallbackStatus {
    SUCCESSFUL = 'SUCCESSFUL',
    FAILED = 'FAILED',
}

export class ProviderCallbackDto {
    @IsString()
    event!: string;

    @IsString()
    providerReference!: string;

    @IsString()
    transactionReference!: string;

    @IsUUID()
    attemptReference!: string;

    // Simulator sends decimal MWK, e.g. 150.00.
    @IsNumber({ allowNaN: false, allowInfinity: false })
    @Min(0.01)
    amount!: number;

    @IsString()
    @Matches(/^MWK$/)
    currency!: string;

    @IsEnum(PaymentProvider)
    provider!: PaymentProvider;

    @IsEnum(ProviderCallbackStatus)
    status!: ProviderCallbackStatus;

    @IsDateString()
    occurredAt!: string;

    @IsOptional()
    @IsString()
    failureCode?: string;

    @IsOptional()
    @IsString()
    failureMessage?: string;
}