import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Length, IsNumber, IsEnum } from 'class-validator';
<<<<<<< HEAD
import { LogDirection, LogStatus } from '../log.entity';
=======
import { LogDirection, LogStatus, LogType } from '../log.entity';
>>>>>>> origin/develop

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
  @IsEnum(LogType)
  type: LogType;

  @ApiProperty()
  @IsOptional()
  @IsEnum(LogStatus)
  status: LogStatus;

  @ApiProperty()
  @IsOptional()
  fiat: any;

  @ApiProperty()
  @IsOptional()
  @IsNumber()
  fiatValue: number;

  @ApiProperty()
  @IsOptional()
  @IsNumber()
  btcValue: number;

  @ApiProperty()
  @IsOptional()
  asset: any;

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
