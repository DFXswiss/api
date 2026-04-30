import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, ValidateIf } from 'class-validator';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';

export class FiatInDto {
  @ApiPropertyOptional({ description: 'Fiat currency ID' })
  @IsNotEmpty()
  @ValidateIf((f: FiatInDto) => Boolean(f.id || !f.name))
  @IsInt()
  id?: number;

  @ApiPropertyOptional({ description: 'Fiat currency code (e.g. EUR, USD, CHF)' })
  @IsNotEmpty()
  @ValidateIf((f: FiatInDto) => Boolean(f.name || !f.id))
  @IsString()
  name?: string;
}

export class FiatDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty()
  buyable: boolean;

  @ApiProperty()
  sellable: boolean;

  @ApiProperty()
  cardBuyable: boolean;

  @ApiProperty()
  cardSellable: boolean;

  @ApiProperty()
  instantBuyable: boolean;

  @ApiProperty()
  instantSellable: boolean;
}

export class VolumeLimitDto {
  @ApiProperty({ description: 'Minimum transaction volume (in fiat)' })
  minVolume: number;

  @ApiProperty({ description: 'Maximum transaction volume (in fiat)' })
  maxVolume: number;
}

export class FiatLimitsDto {
  @ApiProperty()
  [FiatPaymentMethod.BANK]: VolumeLimitDto;

  @ApiProperty()
  [FiatPaymentMethod.INSTANT]: VolumeLimitDto;

  @ApiProperty()
  [FiatPaymentMethod.CARD]: VolumeLimitDto;
}

export class FiatDetailDto extends FiatDto {
  @ApiProperty()
  limits: FiatLimitsDto;

  @ApiProperty()
  allowedIbanCountries: string[];
}
