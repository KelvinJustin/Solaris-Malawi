import { IsEnum, IsPhoneNumber, IsString, MaxLength } from 'class-validator';

import { PaymentProvider } from '../../generated/prisma/enums.js';

/**
 * Customer input for initiating a hosted checkout payment.
 *
 * The server retrieves the transaction amount and reference
 * from the database; the client cannot override either value.
 */
export class InitiateCheckoutPaymentDto {
    /** Provider selected by the customer on the checkout page. */
    @IsEnum(PaymentProvider)
    provider!: PaymentProvider;

    /** Malawian phone number to receive the payment prompt. */
    @IsString()
    @MaxLength(30)
    @IsPhoneNumber('MW')
    phoneNumber!: string;
}