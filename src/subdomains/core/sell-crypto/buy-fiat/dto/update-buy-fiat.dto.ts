import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsDate, IsString, IsNumber, IsEnum, IsBoolean } from 'class-validator';
import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';
import { AmlReason } from 'src/subdomains/core/buy-crypto/process/enums/aml-reason.enum';

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
  @IsEnum(AmlCheck)
  amlCheck: AmlCheck;

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
  inputReferenceAmountMinusFee: number;

  @IsOptional()
  @IsString()
  cryptoReturnTxId: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  cryptoReturnDate: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  mailReturnSendDate: Date;

  @IsOptional()
  @IsNumber()
  outputReferenceAmount: number;

  @IsOptional()
  @IsString()
  outputReferenceAsset: string;

  @IsOptional()
  @IsNumber()
  outputAmount: number;

  @IsOptional()
  @IsString()
  outputAsset: string;

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
}
