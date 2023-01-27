import { Asset } from 'src/shared/models/asset/asset.entity';
import { Deposit } from '../../deposit/deposit.entity';
import { MinDeposit } from '../../deposit/dto/min-deposit.dto';
import { Sell } from '../../../../subdomains/core/sell-crypto/sell/sell.entity';
import { PayoutType } from '../../staking-reward/staking-reward.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';

export class StakingDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  active: boolean;

  @ApiProperty({ type: Deposit })
  deposit: Deposit;

  @ApiProperty({ enum: PayoutType })
  rewardType: PayoutType;

  @ApiPropertyOptional({ type: Sell })
  rewardSell?: Sell;

  @ApiPropertyOptional({ type: AssetDto })
  rewardAsset?: Asset;

  @ApiProperty({ enum: PayoutType })
  paybackType: PayoutType;

  @ApiPropertyOptional({ type: Sell })
  paybackSell?: Sell;

  @ApiPropertyOptional({ type: AssetDto })
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
