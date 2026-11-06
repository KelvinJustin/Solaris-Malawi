import {
    IsEnum,
    IsString,
    Matches,
    MaxLength,
} from 'class-validator';

import { PaymentProvider } from '../../generated/prisma/enums.js';

export class InitiatePaymentDto {
    /**
     * The mobile-money provider selected by the customer.
     */
    @IsEnum(PaymentProvider)
    provider!: PaymentProvider;

    /**
     * The Malawian mobile number used to request payment.
     * Normalize and validate provider-specific formats before calling
     * the provider adapter.
     */
    @IsString()
    @MaxLength(20)
    @Matches(/^[+0-9]+$/, {
        message: 'Phone number must contain only digits and an optional + prefix.',
    })
    phoneNumber!: string;
}