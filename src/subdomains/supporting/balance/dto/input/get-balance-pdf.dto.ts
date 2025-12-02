import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PriceCurrency } from 'src/subdomains/supporting/pricing/services/pricing.service';

export enum PdfLanguage {
  DE = 'DE',
  EN = 'EN',
  FR = 'FR',
  IT = 'IT',
}

export class GetBalancePdfDto {
  @ApiProperty({ description: 'Blockchain address' })
  @IsNotEmpty()
  @IsString()
  address: string;

  @ApiProperty({ description: 'Blockchain', enum: Blockchain })
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;

  @ApiProperty({ description: 'Fiat currency for the report', enum: PriceCurrency })
  @IsNotEmpty()
  @IsEnum(PriceCurrency)
  currency: PriceCurrency;

  @ApiProperty({ description: 'Date for the portfolio report' })
  @IsDate()
  @Type(() => Date)
  date: Date;

  @ApiPropertyOptional({ description: 'Language for the report', enum: PdfLanguage, default: PdfLanguage.EN })
  @IsOptional()
  @IsEnum(PdfLanguage)
  language?: PdfLanguage = PdfLanguage.EN;
}
