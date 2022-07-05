import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsDate, IsString, IsNumber, IsEnum } from 'class-validator';
import { AmlCheck } from '../../crypto-buy/enums/aml-check.enum';

export abstract class CryptoSellDto {
  @IsOptional()
  @IsString()
  recipientMail: string;

  @IsOptional()
  @IsNumber()
  mail1SendDate: number;

  @IsOptional()
  @IsNumber()
  mail2SendDate: number;

  @IsOptional()
  @IsNumber()
  mail3SendDate: number;

  @IsOptional()
  @IsNumber()
  fee: number;

  @IsOptional()
  @IsNumber()
  fiatReferenceAmount: number;

  @IsOptional()
  @IsString()
  fiatReferenceCurrency: string;

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
  @IsString()
  iban: string;

  @IsOptional()
  @IsNumber()
  outputAmount: number;

  @IsOptional()
  @IsString()
  outputCurrency: string;

  @IsOptional()
  @IsString()
  bankUsage: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  outputDate: Date;

  @IsOptional()
  @IsInt()
  bankTxId: number;
}
