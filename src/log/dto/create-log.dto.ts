import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { LogDirection, LogStatus, LogType } from '../log.entity';

export class CreateLogDto {
  @IsOptional()
  @IsString()
  orderId: string;

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
  fiatInCHF: number;

  @ApiProperty()
  @IsOptional()
  asset: any;

  @ApiProperty()
  @IsOptional()
  @IsNumber()
  assetValue: number;

  // @ApiProperty()
  // @IsOptional()
  // //@IsIBAN()
  // iban: string;

  @ApiProperty()
  @IsOptional()
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

  @ApiProperty()
  @IsOptional()
  @IsString()
  blockchainTx: string;
  
}
