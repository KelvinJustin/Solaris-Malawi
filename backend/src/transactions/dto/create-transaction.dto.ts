
import {
  IsInt,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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
  /**
   * Payment amount in tambala.
   *
   * 100 tambala = MWK 1.
   * Integer storage avoids floating-point rounding errors.
   */
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  amountTambala!: number;
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
