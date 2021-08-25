import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { User } from 'src/user/user.entity';
import { LogDirection, LogStatus, LogType } from '../log.entity';

export class CreateLogDto {
  @IsOptional()
  @IsString()
  orderId: string;

  @ApiProperty()
  @IsNotEmpty()
  @Length(34, 42)
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
  @IsString()
  direction: LogDirection;

  @ApiProperty()
  @IsOptional()
  @IsString()
  message: string;

  @IsOptional()
  user: any;

  @ApiProperty()
  @IsOptional()
  @IsString()
  blockchainTx: string;
}
