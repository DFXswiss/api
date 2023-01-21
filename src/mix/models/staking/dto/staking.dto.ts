import { Asset } from 'src/shared/models/asset/asset.entity';
import { Deposit } from '../../deposit/deposit.entity';
import { MinDeposit } from '../../deposit/dto/min-deposit.dto';
import { Sell } from '../../../../subdomains/core/sell-crypto/sell/sell.entity';
import { PayoutType } from '../../staking-reward/staking-reward.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StakingDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  active: boolean;

  @ApiProperty({ type: Deposit })
  deposit: Deposit;

  @ApiProperty({ enum: PayoutType, enumName: 'PayoutType' })
  rewardType: PayoutType;

  @ApiPropertyOptional({ type: Sell })
  rewardSell?: Sell;

  @ApiPropertyOptional({ type: Asset })
  rewardAsset?: Asset;

  @ApiProperty({ enum: PayoutType, enumName: 'PayoutType' })
  paybackType: PayoutType;

  @ApiPropertyOptional({ type: Sell })
  paybackSell?: Sell;

  @ApiPropertyOptional({ type: Asset })
  paybackAsset?: Asset;

  @ApiProperty()
  balance: number;

  @ApiProperty()
  rewardVolume: number;

  @ApiProperty()
  isInUse: boolean;

  @ApiProperty()
  fee: number;

  @ApiProperty()
  period: number;

  @ApiProperty()
  minInvestment: number;

  @ApiProperty({ type: MinDeposit, isArray: true })
  minDeposits: MinDeposit[];
}
