import { ApiProperty } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  Length,
  IsNotEmpty,
  IsISO8601,
  IsEnum,
} from 'class-validator';
import { Buy } from 'src/buy/buy.entity';
import { PaymentError, PaymentStatus } from '../payment.entity';

export class CreateBuyPaymentDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  bankTransactionId: string;

  @IsOptional()
  @Length(34, 34)
  address: string;

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

  @ApiProperty()
  @IsNotEmpty()
  fiat: any;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  fiatValue: number;

  @IsOptional()
  @IsNumber()
  fiatInCHF: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsISO8601()
  received: Date;

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
  @IsEnum(PaymentStatus)
  status: PaymentStatus;

  @IsOptional()
  buy: Buy;
}
