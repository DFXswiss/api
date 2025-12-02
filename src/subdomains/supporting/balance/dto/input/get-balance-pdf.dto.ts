import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsEthereumAddress, IsNotEmpty, IsOptional } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { IsPastDate } from 'src/shared/validators/is-past-date.validator';

export enum FiatCurrency {
  CHF = 'CHF',
  EUR = 'EUR',
  USD = 'USD',
}

export enum PdfLanguage {
  DE = 'DE',
  EN = 'EN',
  FR = 'FR',
  IT = 'IT',
}

export class GetBalancePdfDto {
  @ApiProperty({ description: 'Blockchain address (EVM)' })
  @IsNotEmpty()
  @IsEthereumAddress()
  address: string;

  @ApiProperty({ description: 'Blockchain', enum: Blockchain })
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;

  @ApiProperty({ description: 'Fiat currency for the report', enum: FiatCurrency })
  @IsNotEmpty()
  @IsEnum(FiatCurrency)
  currency: FiatCurrency;

  @ApiProperty({ description: 'Date for the portfolio report (must be in the past)' })
  @IsDate()
  @IsPastDate()
  @Type(() => Date)
  date: Date;

  @ApiPropertyOptional({ description: 'Language for the report', enum: PdfLanguage, default: PdfLanguage.EN })
  @IsOptional()
  @IsEnum(PdfLanguage)
  language?: PdfLanguage = PdfLanguage.EN;
}
