import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';
import { AmlReason } from '../../../aml/enums/aml-reason.enum';
import { CheckStatus } from '../../../aml/enums/check-status.enum';

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
  absoluteFeeAmount: number;

  @IsOptional()
  @IsNumber()
  inputReferenceAmountMinusFee: number;

  @IsOptional()
  @IsNumber()
  outputReferenceAmount: number;

  @IsOptional()
  @IsInt()
  outputReferenceAssetId: number;

  @IsOptional()
  @IsNumber()
  outputAmount: number;

  @IsOptional()
  @IsInt()
  outputAssetId: number;

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
  @IsDate()
  @Type(() => Date)
  mailSendDate: Date;

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
  @IsString()
  chargebackCryptoTxId: string;

  @IsOptional()
  @IsInt()
  chargebackBankTxId: number;

  @IsOptional()
  @IsBoolean()
  isComplete: boolean;

  @IsOptional()
  @IsBoolean()
  highRisk: boolean;

  @IsOptional()
  @IsString()
  comment: string;

  @IsOptional()
  @IsNumber()
  blockchainFee: number;

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
  @IsString()
  chargebackIban: string;

  @IsOptional()
  @IsInt()
  bankDataId: number;

  @IsOptional()
  @IsBoolean()
  bankDataApproved: boolean;

  @IsOptional()
  @IsBoolean()
  bankDataManualApproved: boolean;

  @IsOptional()
  @IsString()
  chargebackAllowedBy: string;

  // Creditor data for FiatOutput (required when chargebackAllowedDate is set)
  @IsOptional()
  @IsString()
  chargebackCreditorName: string;

  @IsOptional()
  @IsString()
  chargebackCreditorAddress: string;

  @IsOptional()
  @IsString()
  chargebackCreditorHouseNumber: string;

  @IsOptional()
  @IsString()
  chargebackCreditorZip: string;

  @IsOptional()
  @IsString()
  chargebackCreditorCity: string;

  @IsOptional()
  @IsString()
  chargebackCreditorCountry: string;
}
