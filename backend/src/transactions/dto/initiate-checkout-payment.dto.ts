import { IsEnum, IsString, ValidateIf } from 'class-validator';
import { PaymentProvider } from '../../generated/prisma/enums.js';

export class InitiateCheckoutPaymentDto {
  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;

  @ValidateIf(
    (dto: InitiateCheckoutPaymentDto) =>
      dto.provider !== PaymentProvider.NOWPAYMENTS,
  )
  @IsString()
  phoneNumber?: string; // required for mobile-money providers, absent for NOWPAYMENTS
}
