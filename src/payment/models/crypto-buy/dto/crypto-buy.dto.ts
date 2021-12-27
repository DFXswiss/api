import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsDate, IsString, IsNumber, IsEnum } from 'class-validator';
import { AmlCheck } from '../crypto-buy.entity';

export abstract class CryptoBuyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  date: string;

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
  @IsDate()
  @Type(() => Date)
  timeStamp: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recipientMail: string;
}
