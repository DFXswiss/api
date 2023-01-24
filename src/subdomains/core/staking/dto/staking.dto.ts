import { Asset } from 'src/shared/models/asset/asset.entity';
import { Deposit } from 'src/subdomains/supporting/address-pool/deposit/deposit.entity';
import { MinDeposit } from 'src/subdomains/supporting/address-pool/deposit/dto/min-deposit.dto';
import { Sell } from '../../../../subdomains/core/sell-crypto/route/sell.entity';
import { PayoutType } from '../entities/staking-reward.entity';

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
  rewardVolume: number;
  isInUse: boolean;
  fee: number;
  period: number;
  minInvestment: number;
  minDeposits: MinDeposit[];
}
