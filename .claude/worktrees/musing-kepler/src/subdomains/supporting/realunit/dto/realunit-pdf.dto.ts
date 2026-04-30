import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDate,
  IsEnum,
  IsEthereumAddress,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { PdfLanguage } from 'src/subdomains/supporting/balance/dto/input/get-balance-pdf.dto';
import { PriceCurrency } from 'src/subdomains/supporting/pricing/services/pricing.service';

export enum ReceiptCurrency {
  CHF = 'CHF',
  EUR = 'EUR',
}

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
  @ApiProperty({ description: 'Transaction hash from blockchain history' })
  @IsNotEmpty()
  @IsString()
  txHash: string;

  @ApiPropertyOptional({
    description: 'Currency for fiat values on receipt',
    enum: ReceiptCurrency,
    default: ReceiptCurrency.CHF,
  })
  @IsOptional()
  @IsEnum(ReceiptCurrency)
  currency?: ReceiptCurrency = ReceiptCurrency.CHF;
}

export class RealUnitMultiReceiptPdfDto {
  @ApiProperty({ type: [String], description: 'Array of transaction hashes from blockchain history' })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  txHashes: string[];

  @ApiPropertyOptional({
    description: 'Currency for fiat values on receipt',
    enum: ReceiptCurrency,
    default: ReceiptCurrency.CHF,
  })
  @IsOptional()
  @IsEnum(ReceiptCurrency)
  currency?: ReceiptCurrency = ReceiptCurrency.CHF;
}
