import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { LogDirection, LogStatus, LogType } from '../log.entity';

export class CreateLogDto {
  @IsOptional()
  @IsInt()
  id: number;

  @IsOptional()
  @IsString()
  orderId: string;

  @ApiProperty()
  @IsNotEmpty()
  @Length(34, 34)
  @IsString()
  address: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  type: LogType;

  @ApiProperty()
  @IsOptional()
  @IsString()
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
  @IsNumber()
  fiatInCHF: number;

  @ApiProperty()
  @IsOptional()
  asset: number;

  @ApiProperty()
  @IsOptional()
  @IsNumber()
  assetValue: number;

  @ApiProperty()
  @IsOptional()
  //@IsIBAN()
  iban: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  direction: LogDirection;

  @ApiProperty()
  @IsOptional()
  @IsString()
  message: string;

  @IsString()
  @IsOptional()
  created: Date;
}
