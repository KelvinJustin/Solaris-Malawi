import { IsEnum, IsOptional, IsString, ValidateIf } from 'class-validator';
import { PaymentProvider } from '../../generated/prisma/enums.js';

export class InitiateCheckoutPaymentDto {
  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;

  @ValidateIf((dto: InitiateCheckoutPaymentDto) => dto.provider !== PaymentProvider.NOWPAYMENTS)
  @IsString()
  phoneNumber?: string; // required for mobile-money providers, absent for NOWPAYMENTS

  @ValidateIf((dto: InitiateCheckoutPaymentDto) => dto.provider === PaymentProvider.NOWPAYMENTS)
  @IsString()
  payCurrency?: string; // e.g. "usdttrc20" — required, and only meaningful, for NOWPAYMENTS

  @IsOptional()
  @IsString()
  network?: string;
}