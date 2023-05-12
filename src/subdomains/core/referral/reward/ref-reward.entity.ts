import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
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
@Index('oneRewardPerUserCheck', (reward: RefReward) => [reward.txId, reward.user, reward.status], { unique: true })
export class RefReward extends Reward {
  @ManyToOne(() => User, { nullable: false })
  user: User;

  @Column({ length: 256, nullable: true })
  targetAddress: string;

  @Column({ length: 256, nullable: true })
  targetBlockchain: Blockchain;

  @Column({ nullable: true })
  status: RewardStatus;

  // Methods
  sendMail(): UpdateResult<RefReward> {
    this.recipientMail = this.user.userData.mail;
    this.mailSendDate = new Date();

    return [this.id, { recipientMail: this.recipientMail, mailSendDate: this.mailSendDate }];
  }

  payingOut(): UpdateResult<RefReward> {
    this.status = RewardStatus.PAYING_OUT;

    return [this.id, { status: this.status }];
  }

  complete(payoutTxId: string): UpdateResult<RefReward> {
    this.txId = payoutTxId;
    this.outputDate = new Date();
    this.status = RewardStatus.COMPLETE;

    return [this.id, { txId: this.txId, outputDate: this.outputDate, status: this.status }];
  }
}
