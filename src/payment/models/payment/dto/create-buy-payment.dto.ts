import { ApiProperty } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  Length,
  IsNotEmpty,
  IsISO8601,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { Buy } from 'src/user/models/buy/buy.entity';
import { PaymentError, PaymentStatus } from '../payment.entity';

export class CreateBuyPaymentDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  bankTransactionId: string;

  @IsOptional()
  @Length(34, 34)
  address: string; // TODO: remove?

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  iban: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  location: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  name: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  country: string;

  @IsOptional()
  @IsNumber()
  btcValue: number;

  @ApiProperty()
  @IsNotEmpty()
  fiat: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  fiatValue: number;

  @ApiProperty()
  @IsNotEmpty()
  originFiat: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  originFiatValue: number;

  @IsOptional()
  @IsNumber()
  fiatInCHF: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsISO8601()
  received: string;

  @IsOptional()
  asset: any;

  @ApiProperty()
  @IsOptional()
  bankUsage: string;

  @IsOptional()
  @IsString()
  info: string;

  @IsOptional()
  @IsEnum(PaymentError)
  errorCode: PaymentError;

  @IsOptional()
  @IsBoolean()
  accepted: boolean
  
  @IsOptional()
  @IsEnum(PaymentStatus)
  status: PaymentStatus;

  @IsOptional()
  buy: Buy;
}
