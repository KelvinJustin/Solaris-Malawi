import { IsString, MaxLength } from 'class-validator';

export class RejectMerchantApplicationDto {
  @IsString()
  @MaxLength(1000)
  reason!: string;
}
