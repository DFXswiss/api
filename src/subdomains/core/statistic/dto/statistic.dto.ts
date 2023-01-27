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

class YieldStakingStatistic {
  @ApiProperty()
  apr: number;

  @ApiProperty()
  apy: number;
}

class StakingStatistic {
  @ApiProperty()
  masternodes: number;

  @ApiProperty({ type: YieldStakingStatistic })
  yield: YieldStakingStatistic;
}

export class SettingStatus {
  [key: string]: string;
}

export class StatisticDto {
  @ApiProperty({ type: TotalVolumeStatistic })
  totalVolume: TotalVolumeStatistic;

  @ApiProperty({ type: TotalRewardsStatistic })
  totalRewards: TotalRewardsStatistic;

  @ApiProperty({ type: StakingStatistic })
  staking: StakingStatistic;

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
  stakingRewards: TransactionDetailsDto[];

  @ApiProperty({ type: TransactionDetailsDto, isArray: true })
  refRewards: TransactionDetailsDto[];
}
