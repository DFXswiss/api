import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty } from 'class-validator';
import { PriceCurrency } from 'src/subdomains/supporting/pricing/services/pricing.service';

export class GetCustodyPdfDto {
  @ApiProperty({ description: 'Fiat currency for the report', enum: PriceCurrency })
  @IsNotEmpty()
  @IsEnum(PriceCurrency)
  currency: PriceCurrency;

  @ApiProperty({ description: 'Date for the portfolio report (must be in the past)' })
  @IsDate()
  @Type(() => Date)
  date: Date;
}
