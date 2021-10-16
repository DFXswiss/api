import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Length } from 'class-validator';
import { LogDirection, LogStatus, LogType } from '../log.entity';

export class CreateVolumeLogDto {
  @IsOptional()
  @IsString()
  orderId: string;

  @ApiProperty()
  @IsNotEmpty()
  @Length(34, 42)
  @IsString()
  address: string;

  @ApiProperty()
  @IsOptional()
  @IsEnum(LogType)
  type: LogType;

  @ApiProperty()
  @IsNotEmpty()
  fiat: any;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  fiatValue: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  fiatInCHF: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  btcValue: number;

  @ApiProperty()
  @IsNotEmpty()
  asset: any;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  assetValue: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(LogDirection)
  direction: LogDirection;

  @ApiProperty()
  @IsOptional()
  @IsString()
  message: string;

  @IsOptional()
  user: any;

  @IsOptional()
  payment: any;
}
