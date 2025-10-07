import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { BankTxType } from '../entities/bank-tx.entity';

export class UpdateBankTxDto {
  @IsOptional()
  @IsEnum(BankTxType)
  type: BankTxType;

  @IsOptional()
  @IsNumber()
  accountingAmountBeforeFee?: number;

  @IsOptional()
  @IsNumber()
  accountingFeeAmount?: number;

  @IsOptional()
  @IsNumber()
  accountingFeePercent?: number;

  @IsOptional()
  @IsNumber()
  accountingAmountAfterFee?: number;

  @IsOptional()
  @IsNumber()
  accountingAmountBeforeFeeChf?: number;

  @IsOptional()
  @IsNumber()
  accountingAmountAfterFeeChf?: number;

  @IsOptional()
  @IsString()
  iban?: string;

  @IsOptional()
  @IsString()
  bic?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  addressLine1?: string;

  @IsOptional()
  @IsString()
  addressLine2?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  ultimateName?: string;

  @IsOptional()
  @IsString()
  ultimateAddressLine1?: string;

  @IsOptional()
  @IsString()
  ultimateAddressLine2?: string;

  @IsOptional()
  @IsString()
  ultimateCountry?: string;

  @IsNotEmpty()
  @IsInt()
  @ValidateIf((p: UpdateBankTxDto) => p.type === BankTxType.BUY_CRYPTO)
  buyId?: number;

  @IsOptional()
  @IsBoolean()
  highRisk?: boolean;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  bankReleaseDate?: Date;
}
