import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsDate, IsString, IsNumber, IsEnum } from 'class-validator';
import { AmlCheck } from '../../crypto-buy/enums/aml-check.enum';

export abstract class CryptoSellDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recipientMail: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  mail1SendDate: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  mail2SendDate: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  mail3SendDate: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  fee: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  fiatReferenceAmount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fiatReferenceCurrency: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amountInChf: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amountInEur: number;

  @ApiProperty()
  @IsOptional()
  @IsEnum(AmlCheck)
  amlCheck: AmlCheck;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  iban: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  outputAmount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  outputCurrency: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankUsage: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  outputDate: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  bankTxId: number;
}
