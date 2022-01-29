import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsDate, IsString, IsNumber, IsEnum } from 'class-validator';
import { AmlCheck } from '../../crypto-buy/crypto-buy.entity';

export abstract class CryptoSellDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recipientMail: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  mail1Send: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  mail2Send: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  mail3Send: number;

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
  fiatReferenceAsset: string;

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
  outputFiat: string;

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
