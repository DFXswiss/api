import { Deposit } from '../../deposit/deposit.entity';
import { Sell } from '../../sell/sell.entity';
import { StakingType } from './staking-type.enum';

export class StakingDto {
  id: number;
  active: boolean;
  deposit: Deposit;
  rewardType: StakingType;
  rewardSell?: Sell;
  paybackType: StakingType;
  paybackSell?: Sell;
}
