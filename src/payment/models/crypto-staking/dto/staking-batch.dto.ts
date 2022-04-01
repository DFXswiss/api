import { PayoutType } from '../../staking-reward/staking-reward.entity';

export class StakingBatchDto {
  amount: number;
  outputDate: Date;
  payoutType: PayoutType;
}
