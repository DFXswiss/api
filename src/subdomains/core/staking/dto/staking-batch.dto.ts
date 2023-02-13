import { PayoutType } from '../../../../subdomains/core/staking/entities/staking-reward.entity';

export class StakingBatchDto {
  amount: number;
  outputDate: Date;
  payoutType: PayoutType;
}
