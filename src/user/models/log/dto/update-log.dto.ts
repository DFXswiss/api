import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Length, IsNumber, IsEnum } from 'class-validator';
import { LogDirection, LogStatus } from '../log.entity';

export class UpdateLogDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  id: number;

  @ApiProperty()
  @IsOptional()
  @Length(34, 42)
  @IsString()
  address: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  type: string;

  @ApiProperty()
  @IsOptional()
  @IsEnum(LogStatus)
  status: LogStatus;

  @ApiProperty()
  @IsOptional()
  fiat: number;

  @ApiProperty()
  @IsOptional()
  @IsNumber()
  fiatValue: number;

  @ApiProperty()
  @IsOptional()
  asset: number;

  @ApiProperty()
  @IsOptional()
  @IsNumber()
  assetValue: number;

  @ApiProperty()
  @IsOptional()
  @IsString()
  usedRef: string;

  @ApiProperty()
  @IsOptional()
  @IsNumber()
  refFeePercent: number;

  @ApiProperty()
  @IsOptional()
  @IsNumber()
  refFeeValue: number;

  @ApiProperty()
  @IsOptional()
  refFeeAsset: any;

  @ApiProperty()
  @IsOptional()
  usedWallet: any;

  @ApiProperty()
  @IsOptional()
  @IsNumber()
  walletFeeValue: number;

  @ApiProperty()
  @IsOptional()
  @IsNumber()
  walletFeePercent: number;

  @ApiProperty()
  @IsOptional()
  walletFeeAsset: any;

  @ApiProperty()
  @IsOptional()
  @IsNumber()
  dfxFeePercent: number;

  @ApiProperty()
  @IsOptional()
  @IsNumber()
  dfxFeeValue: number;

  @ApiProperty()
  @IsOptional()
  dfxFeeAsset: any;

  @ApiProperty()
  @IsOptional()
  @IsEnum(LogDirection)
  direction: LogDirection;

  @ApiProperty()
  @IsOptional()
  @IsString()
  message: string;
}
