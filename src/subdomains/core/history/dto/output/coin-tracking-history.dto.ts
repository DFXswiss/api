import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum CoinTrackingTransactionType {
  DEPOSIT = 'Deposit',
  WITHDRAWAL = 'Withdrawal',
  STAKING = 'Staking',
  REWARD_BONUS = 'Reward / Bonus',
  TRADE = 'Trade',
  OTHER_FEE = 'Other Fee',
}

export class CoinTrackingHistoryBase {
  @ApiProperty({ enum: CoinTrackingTransactionType })
  type: CoinTrackingTransactionType;

  @ApiPropertyOptional()
  buyAmount: number;

  @ApiPropertyOptional()
  buyAsset: string;

  @ApiPropertyOptional()
  sellAmount: number;

  @ApiPropertyOptional()
  sellAsset: string;

  @ApiPropertyOptional()
  fee: number;

  @ApiPropertyOptional()
  feeAsset: string;

  @ApiProperty()
  exchange: string;

  @ApiPropertyOptional()
  tradeGroup: string;

  @ApiPropertyOptional()
  comment: string;

  @ApiProperty()
  txId: string;

  @ApiPropertyOptional()
  buyValueInEur: number;

  @ApiPropertyOptional()
  sellValueInEur: number;
}

export class CoinTrackingCsvHistoryDto extends CoinTrackingHistoryBase {
  @ApiProperty({ type: Date })
  date: Date;
}

export class CoinTrackingApiHistoryDto extends CoinTrackingHistoryBase {
  @ApiProperty()
  date: number;
}
