import { Asset } from 'src/shared/models/asset/asset.entity';
import { Deposit } from '../../deposit/deposit.entity';
import { Sell } from '../../sell/sell.entity';
import { PayoutType } from '../../staking-reward/staking-reward.entity';

export class StakingDto {
  id: number;
  active: boolean;
  deposit: Deposit;
  rewardType: PayoutType;
  rewardSell?: Sell;
  rewardAsset?: Asset;
  paybackType: PayoutType;
  paybackSell?: Sell;
  paybackAsset?: Asset;
  balance: number;
  isInUse: boolean;
}
