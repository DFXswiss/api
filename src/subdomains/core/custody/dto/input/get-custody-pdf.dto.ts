import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { PriceCurrency } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PdfLanguage } from 'src/subdomains/supporting/balance/dto/input/get-balance-pdf.dto';

export class GetCustodyPdfDto {
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
