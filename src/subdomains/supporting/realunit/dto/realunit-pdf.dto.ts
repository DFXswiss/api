import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDate,
  IsEnum,
  IsEthereumAddress,
  IsNotEmpty,
  IsNumber,
  IsOptional,
} from 'class-validator';
import { PdfLanguage } from 'src/subdomains/supporting/balance/dto/input/get-balance-pdf.dto';
import { PriceCurrency } from 'src/subdomains/supporting/pricing/services/pricing.service';

export class RealUnitBalancePdfDto {
  @ApiProperty({ description: 'Blockchain address (EVM)' })
  @IsNotEmpty()
  @IsEthereumAddress()
  address: string;

  @ApiProperty({ description: 'Fiat currency for the report', enum: PriceCurrency })
  @IsNotEmpty()
  @IsEnum(PriceCurrency)
  currency: PriceCurrency;

  @ApiProperty({ description: 'Date for the portfolio report (must be in the past)' })
  @IsDate()
  @Type(() => Date)
  date: Date;

  @ApiPropertyOptional({ description: 'Language for the report', enum: PdfLanguage, default: PdfLanguage.EN })
  @IsOptional()
  @IsEnum(PdfLanguage)
  language?: PdfLanguage = PdfLanguage.EN;
}

export class RealUnitSingleReceiptPdfDto {
  @ApiProperty({ type: Number, description: 'Transaction ID' })
  @IsNumber()
  @Type(() => Number)
  transactionId: number;
}

export class RealUnitMultiReceiptPdfDto {
  @ApiProperty({ type: [Number], description: 'Array of transaction IDs to include in the receipt' })
  @IsArray()
  @IsNumber({}, { each: true })
  @ArrayMinSize(1)
  transactionIds: number[];
}
