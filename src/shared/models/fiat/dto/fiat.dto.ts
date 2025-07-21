import { ApiProperty } from '@nestjs/swagger';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';

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
  allowedIbanCountry: string[];
}
