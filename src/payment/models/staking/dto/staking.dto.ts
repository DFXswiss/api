import { Asset } from 'src/shared/models/asset/asset.entity';
import { Deposit } from '../../deposit/deposit.entity';
import { Sell } from '../../sell/sell.entity';
import { StakingType } from './staking-type.enum';

export class StakingDto {
  id: number;
  active: boolean;
  deposit: Deposit;
  rewardType: StakingType;
  rewardSell?: Sell;
  rewardAsset?: Asset;
  paybackType: StakingType;
  paybackSell?: Sell;
  paybackAsset?: Asset;
  balance: number;
  isInUse: boolean;
}
