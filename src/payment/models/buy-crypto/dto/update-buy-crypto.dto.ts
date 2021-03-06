import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsDate, IsString, IsNumber, IsEnum } from 'class-validator';
import { AmlCheck } from '../enums/aml-check.enum';

export class UpdateBuyCryptoDto {
  @IsOptional()
  @IsInt()
  buyId: number;

  @IsOptional()
  @IsInt()
  cryptoRouteId: number;

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
  txId: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  outputDate: Date;

  @IsOptional()
  @IsString()
  recipientMail: string;

  @IsOptional()
  @IsNumber()
  mailSendDate: number;

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
  @IsDate()
  @Type(() => Date)
  chargebackDate: Date;

  @IsOptional()
  @IsString()
  chargebackRemittanceInfo: string;

  @IsOptional()
  @IsInt()
  chargebackBankTxId: number;
}
