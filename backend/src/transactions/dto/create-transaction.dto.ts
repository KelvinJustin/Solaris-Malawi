
import {
  Equals,
  IsInt,
  IsEnum,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Max,
  MaxLength,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaymentProvider, PaymentType } from '../../generated/prisma/enums.js';

/**
 * Defines the payment details a merchant can submit to Solaris.
 *
 * The customer chooses Airtel Money or TNM Mpamba later on
 * the Solaris-hosted checkout page.
 *
 * Merchant identity, payment status, provider, and provider
 * references are managed by the backend.
 */
export class CreateTransactionDto {
  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType;

  /**
   * Payment amount in tambala.
   *
   * 100 tambala = MWK 1.
   * Integer storage avoids floating-point rounding errors.
   */
  @ValidateIf((dto: CreateTransactionDto) => dto.paymentType !== PaymentType.CRYPTO)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  amountTambala?: number;

  @ValidateIf((dto: CreateTransactionDto) => dto.paymentType === PaymentType.CRYPTO)
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/)
  amount?: string;

  @ValidateIf((dto: CreateTransactionDto) => dto.paymentType === PaymentType.CRYPTO)
  @Equals(PaymentProvider.NOWPAYMENTS)
  provider?: PaymentProvider;

  @ValidateIf((dto: CreateTransactionDto) => dto.paymentType === PaymentType.CRYPTO)
  @IsString()
  @Matches(/^[A-Za-z0-9]{2,20}$/)
  asset?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{2,20}$/)
  network?: string | null;
  /**
   * Optional phone number supplied by the merchant.
   *
   * If omitted, the customer can enter their number at checkout.
   */
  @IsOptional()
  @IsPhoneNumber('MW')
  customerPhone?: string;

  /**
   * Optional description displayed during checkout.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  /**
   * Optional reference from the merchant's own system.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  merchantReference?: string;
}
