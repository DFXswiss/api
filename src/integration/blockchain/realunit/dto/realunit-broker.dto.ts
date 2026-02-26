import { ApiProperty } from '@nestjs/swagger';

export class BrokerbotPriceDto {
  @ApiProperty({ description: 'Current price per share in CHF' })
  pricePerShare: string;

  @ApiProperty({ description: 'Available shares for purchase' })
  availableShares: number;
}

export class BrokerbotBuyPriceDto {
  @ApiProperty({ description: 'Number of shares' })
  shares: number;

  @ApiProperty({ description: 'Total cost in CHF' })
  totalPrice: string;

  @ApiProperty({ description: 'Price per share in CHF' })
  pricePerShare: string;

  @ApiProperty({ description: 'Available shares for purchase' })
  availableShares: number;
}

export class BrokerbotSharesDto {
  @ApiProperty({ description: 'Amount in CHF' })
  amount: string;

  @ApiProperty({ description: 'Number of shares that can be purchased' })
  shares: number;

  @ApiProperty({ description: 'Price per share in CHF' })
  pricePerShare: string;

  @ApiProperty({ description: 'Available shares for purchase' })
  availableShares: number;
}

export class BrokerbotInfoDto {
  @ApiProperty({ description: 'Brokerbot contract address' })
  brokerbotAddress: string;

  @ApiProperty({ description: 'REALU token address' })
  tokenAddress: string;

  @ApiProperty({ description: 'Base currency (ZCHF) address' })
  baseCurrencyAddress: string;

  @ApiProperty({ description: 'Current price per share in CHF' })
  pricePerShare: string;

  @ApiProperty({ description: 'Whether buying is enabled' })
  buyingEnabled: boolean;

  @ApiProperty({ description: 'Whether selling is enabled' })
  sellingEnabled: boolean;

  @ApiProperty({ description: 'Available shares for purchase' })
  availableShares: number;
}
