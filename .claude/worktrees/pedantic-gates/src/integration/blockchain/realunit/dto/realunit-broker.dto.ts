import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export enum BrokerbotCurrency {
  CHF = 'CHF',
  EUR = 'EUR',
}

export class BrokerbotCurrencyQueryDto {
  @ApiPropertyOptional({
    enum: BrokerbotCurrency,
    description: 'Currency for prices (CHF or EUR)',
    default: BrokerbotCurrency.CHF,
  })
  @IsOptional()
  @IsEnum(BrokerbotCurrency)
  currency?: BrokerbotCurrency;
}

export class BrokerbotPriceDto {
  @ApiProperty({ description: 'Current price per share' })
  pricePerShare: number;

  @ApiProperty({ description: 'Currency of the price', enum: BrokerbotCurrency })
  currency: BrokerbotCurrency;

  @ApiProperty({ description: 'Available shares for purchase' })
  availableShares: number;
}

export class BrokerbotBuyPriceDto {
  @ApiProperty({ description: 'Number of shares' })
  shares: number;

  @ApiProperty({ description: 'Total cost' })
  totalPrice: number;

  @ApiProperty({ description: 'Price per share' })
  pricePerShare: number;

  @ApiProperty({ description: 'Currency of the prices', enum: BrokerbotCurrency })
  currency: BrokerbotCurrency;

  @ApiProperty({ description: 'Available shares for purchase' })
  availableShares: number;
}

export class BrokerbotBuySharesDto {
  @ApiProperty({ description: 'Amount in specified currency' })
  amount: number;

  @ApiProperty({ description: 'Number of shares that can be purchased' })
  shares: number;

  @ApiProperty({ description: 'Price per share' })
  pricePerShare: number;

  @ApiProperty({ description: 'Currency of the prices', enum: BrokerbotCurrency })
  currency: BrokerbotCurrency;

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

  @ApiProperty({ description: 'Current price per share' })
  pricePerShare: number;

  @ApiProperty({ description: 'Currency of the price', enum: BrokerbotCurrency })
  currency: BrokerbotCurrency;

  @ApiProperty({ description: 'Whether buying is enabled' })
  buyingEnabled: boolean;

  @ApiProperty({ description: 'Whether selling is enabled' })
  sellingEnabled: boolean;

  @ApiProperty({ description: 'Available shares for purchase' })
  availableShares: number;
}

export class BrokerbotSellPriceDto {
  @ApiProperty({ description: 'Number of shares to sell' })
  shares: number;

  @ApiProperty({ description: 'Price per share (including fees)' })
  pricePerShare: number;

  @ApiProperty({ description: 'Estimated amount after fees' })
  estimatedAmount: number;

  @ApiProperty({ description: 'Currency of the prices', enum: BrokerbotCurrency })
  currency: BrokerbotCurrency;
}

export class BrokerbotSellSharesDto {
  @ApiProperty({ description: 'Target amount to receive after fees' })
  targetAmount: number;

  @ApiProperty({ description: 'Number of shares needed to sell' })
  shares: number;

  @ApiProperty({ description: 'Price per share (including fees)' })
  pricePerShare: number;

  @ApiProperty({ description: 'Currency of the prices', enum: BrokerbotCurrency })
  currency: BrokerbotCurrency;
}
