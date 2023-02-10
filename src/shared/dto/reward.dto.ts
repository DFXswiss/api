import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, IsNumber, IsDate } from 'class-validator';

export abstract class RewardDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  inputAmount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inputAsset: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  inputReferenceAmount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inputReferenceAsset: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  outputReferenceAmount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  outputReferenceAsset: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  outputAmount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  outputAsset: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recipientMail: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  mailSendDate: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amountInChf: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amountInEur: number;
}
