import { ApiProperty } from '@nestjs/swagger';

class TotalVolumeStatistic {
  @ApiProperty()
  buy: number;

  @ApiProperty()
  sell: number;
}

class TotalRewardsStatistic {
  @ApiProperty()
  staking: number;

  @ApiProperty()
  ref: number;
}

export class SettingStatus {
  [key: string]: string;
}

export class StatisticDto {
  @ApiProperty({ type: TotalVolumeStatistic, description: 'Amount in CHF' })
  totalVolume: TotalVolumeStatistic;

  @ApiProperty({ type: TotalRewardsStatistic })
  totalRewards: TotalRewardsStatistic;

  @ApiProperty({ type: SettingStatus })
  status: SettingStatus;
}
export class TransactionDetailsDto {
  @ApiProperty()
  fiatAmount: number;

  @ApiProperty()
  fiatCurrency: string;

  @ApiProperty()
  date: Date;

  @ApiProperty()
  cryptoAmount: number;

  @ApiProperty()
  cryptoCurrency: string;
}

export class TransactionStatisticDto {
  @ApiProperty({ type: TransactionDetailsDto, isArray: true })
  buy: TransactionDetailsDto[];

  @ApiProperty({ type: TransactionDetailsDto, isArray: true })
  sell: TransactionDetailsDto[];

  @ApiProperty({ type: TransactionDetailsDto, isArray: true })
  refRewards: TransactionDetailsDto[];
}
