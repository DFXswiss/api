import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsDate, IsString, IsNumber, IsEnum, IsBoolean } from 'class-validator';
import { AmlCheck } from '../crypto-buy.entity';

export abstract class CryptoBuyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  inputDate: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currency: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amountInChf: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amountInEur: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressLine1: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressLine2: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  buyId: number;

  @ApiProperty()
  @IsOptional()
  @IsEnum(AmlCheck)
  amlCheck: AmlCheck;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cryptoAmount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cryptoAsset: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  fee: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  outputAmount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  txId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  usedRef: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  refFactor: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  outputDate: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recipientMail: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  refProvision: number;
}
