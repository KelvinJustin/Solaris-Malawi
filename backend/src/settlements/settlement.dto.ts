import { IsInt, IsPositive, IsString } from 'class-validator';

export class ImportProviderSettlementDto {
  @IsString()
  report!: string;
}

export class AllocateSettlementBankCreditDto {
  @IsString()
  batchId!: string;

  @IsString()
  bankStatementLineId!: string;

  @IsInt()
  @IsPositive()
  amountTambala!: number;

  @IsString()
  idempotencyKey!: string;
}
