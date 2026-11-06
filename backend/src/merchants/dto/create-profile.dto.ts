import {
  IsEnum,
  IsOptional,
  IsString,
  IsEmail,
  IsPhoneNumber,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { BusinessType } from '../../generated/prisma/enums.js';

export class CreateProfileDto {

  @IsOptional()
  @IsString()
  @MaxLength(100)
  businessName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tradingName?: string;

  @IsOptional()
  @IsEnum(BusinessType)
  businessType?: BusinessType;

  @IsOptional()
  @IsString()
  businessRegistrationNo?: string;

  @IsOptional()
  @IsString()
  taxIdentificationNo?: string;

  @IsOptional()
  @IsString()
  merchantCategoryCode?: string;

  @IsOptional()
  @IsString()
  industryDescription?: string;

  @IsOptional()
  @IsEmail()
  supportEmail?: string;

  @IsOptional()
  @IsPhoneNumber('MW')
  supportPhone?: string;

  @IsOptional()
  @IsUrl()
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  addressLine1?: string;

  @IsOptional()
  @IsString()
  addressLine2?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  district?: string;
}