import { ApiProperty } from '@nestjs/swagger';

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

export class FiatDetailDto extends FiatDto {
  @ApiProperty({ description: 'Minimum transaction volume (in fiat)' })
  minVolume: number;

  @ApiProperty({ description: 'Maximum transaction volume (in fiat)' })
  maxVolume: number;
}
