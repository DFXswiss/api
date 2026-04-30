import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';

export class UpdateBuyFiatDto {
  @IsOptional()
  @IsInt()
  sellId: number;

  @IsOptional()
  @IsInt()
  bankTxId: number;

  @IsOptional()
  @IsString()
  recipientMail: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  mail1SendDate: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  mail2SendDate: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  mail3SendDate: Date;

  @IsOptional()
  @IsNumber()
  inputAmount: number;

  @IsOptional()
  @IsString()
  inputAsset: string;

  @IsOptional()
  @IsNumber()
  inputReferenceAmount: number;

  @IsOptional()
  @IsString()
  inputReferenceAsset: string;

  @IsOptional()
  @IsNumber()
  amountInChf: number;

  @IsOptional()
  @IsNumber()
  amountInEur: number;

  @IsOptional()
  @IsEnum(CheckStatus)
  amlCheck: CheckStatus;

  @IsOptional()
  @IsEnum(AmlReason)
  amlReason: AmlReason;

  @IsOptional()
  @IsNumber()
  percentFee: number;

  @IsOptional()
  @IsNumber()
  percentFeeAmount: number;

  @IsOptional()
  @IsNumber()
  absoluteFeeAmount: number;

  @IsOptional()
  @IsNumber()
  minFeeAmount: number;

  @IsOptional()
  @IsNumber()
  minFeeAmountFiat: number;

  @IsOptional()
  @IsNumber()
  totalFeeAmount: number;

  @IsOptional()
  @IsNumber()
  totalFeeAmountChf: number;

  @IsOptional()
  @IsNumber()
  inputReferenceAmountMinusFee: number;

  @IsOptional()
  @IsString()
  chargebackTxId: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  chargebackDate: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  mailReturnSendDate: Date;

  @IsOptional()
  @IsNumber()
  outputReferenceAmount: number;

  @IsOptional()
  @IsString()
  outputReferenceAssetId: number;

  @IsOptional()
  @IsNumber()
  outputAmount: number;

  @IsOptional()
  @IsString()
  outputAssetId: number;

  @IsOptional()
  @IsString()
  remittanceInfo: string;

  @IsOptional()
  @IsBoolean()
  instantSepa: boolean;

  @IsOptional()
  @IsString()
  usedBank: string;

  @IsOptional()
  @IsNumber()
  bankBatchId: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  bankStartTimestamp: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  bankFinishTimestamp: Date;

  @IsOptional()
  @IsString()
  info: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  outputDate: Date;

  @IsOptional()
  @IsBoolean()
  isComplete: boolean;

  @IsOptional()
  @IsString()
  usedRef: string;

  @IsOptional()
  @IsNumber()
  refProvision: number;

  @IsOptional()
  @IsNumber()
  refFactor: number;

  @IsOptional()
  @IsBoolean()
  highRisk: boolean;

  @IsOptional()
  @IsString()
  comment: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  priceDefinitionAllowedDate: Date;

  @IsOptional()
  @IsString()
  amlResponsible: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  chargebackAllowedDate: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  chargebackAllowedDateUser: Date;

  @IsOptional()
  @IsInt()
  bankDataId: number;

  @IsOptional()
  @IsBoolean()
  bankDataActive: boolean;

  @IsOptional()
  @IsString()
  chargebackAllowedBy: string;
}
