import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { Reward } from '../../../../shared/models/reward.entity';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { UpdateResult } from 'src/shared/models/entity';

export enum RewardStatus {
  CREATED = 'Created',
  PREPARED = 'Prepared',
  PENDING_LIQUIDITY = 'PendingLiquidity',
  READY_FOR_PAYOUT = 'ReadyForPayout',
  PAYING_OUT = 'PayingOut',
  COMPLETE = 'Complete',
}

@Entity()
export class RefReward extends Reward {
  @ManyToOne(() => User, { nullable: false })
  user: User;

  @Column({ length: 256, nullable: true })
  targetAddress: string;

  @Column({ length: 256, nullable: true })
  targetBlockchain: Blockchain;

  @Column({ nullable: true })
  status: RewardStatus;

  //*** FACTORY METHODS ***//

  readyToPayout(outputAmount: number): UpdateResult<RefReward> {
    const update: Partial<RefReward> = {
      status: RewardStatus.READY_FOR_PAYOUT,
      outputAmount,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  payingOut(): UpdateResult<RefReward> {
    const update: Partial<RefReward> = { status: RewardStatus.PAYING_OUT };

    Object.assign(this, update);

    return [this.id, update];
  }

  complete(payoutTxId: string): UpdateResult<RefReward> {
    const update: Partial<RefReward> = {
      txId: payoutTxId,
      outputDate: new Date(),
      status: RewardStatus.COMPLETE,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  sendMail(): UpdateResult<RefReward> {
    const update: Partial<RefReward> = {
      recipientMail: this.user.userData.mail,
      mailSendDate: new Date(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }
}
