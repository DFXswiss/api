import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsInt, IsNotEmpty, IsNumber, IsString, ValidateIf } from 'class-validator';
import { IsOptionalButNotNull } from 'src/shared/validators/is-not-null.validator';
import { BankTxType } from '../entities/bank-tx.entity';

export class UpdateBankTxDto {
  @IsOptionalButNotNull()
  @IsEnum(BankTxType)
  type: BankTxType;

  @IsOptionalButNotNull()
  @IsNumber()
  accountingAmountBeforeFee?: number;

  @IsOptionalButNotNull()
  @IsNumber()
  accountingFeeAmount?: number;

  @IsOptionalButNotNull()
  @IsNumber()
  accountingFeePercent?: number;

  @IsOptionalButNotNull()
  @IsNumber()
  accountingAmountAfterFee?: number;

  @IsOptionalButNotNull()
  @IsNumber()
  accountingAmountBeforeFeeChf?: number;

  @IsOptionalButNotNull()
  @IsNumber()
  accountingAmountAfterFeeChf?: number;

  @IsOptionalButNotNull()
  @IsString()
  iban?: string;

  @IsOptionalButNotNull()
  @IsString()
  bic?: string;

  @IsOptionalButNotNull()
  @IsString()
  name?: string;

  @IsOptionalButNotNull()
  @IsString()
  addressLine1?: string;

  @IsOptionalButNotNull()
  @IsString()
  addressLine2?: string;

  @IsOptionalButNotNull()
  @IsString()
  country?: string;

  @IsOptionalButNotNull()
  @IsString()
  ultimateName?: string;

  @IsOptionalButNotNull()
  @IsString()
  ultimateAddressLine1?: string;

  @IsOptionalButNotNull()
  @IsString()
  ultimateAddressLine2?: string;

  @IsOptionalButNotNull()
  @IsString()
  ultimateCountry?: string;

  @IsNotEmpty()
  @IsInt()
  @ValidateIf((p: UpdateBankTxDto) => p.type === BankTxType.BUY_CRYPTO)
  buyId?: number;

  @IsOptionalButNotNull()
  @IsBoolean()
  highRisk?: boolean;

  @IsOptionalButNotNull()
  @IsDate()
  @Type(() => Date)
  bankReleaseDate?: Date;
}
