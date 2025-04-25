import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { UpdateResult } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { Reward } from '../../../../shared/models/reward.entity';

export enum RewardStatus {
  CREATED = 'Created',
  MANUAL_CHECK = 'ManualCheck',
  PREPARED = 'Prepared',
  PENDING_LIQUIDITY = 'PendingLiquidity',
  READY_FOR_PAYOUT = 'ReadyForPayout',
  PAYING_OUT = 'PayingOut',
  COMPLETE = 'Complete',
  FAILED = 'Failed',
  USER_SWITCH = 'UserSwitch', // Status to sync paidRefReward if user wants to change ref to new user
}

@Entity()
export class RefReward extends Reward {
  @ManyToOne(() => User, { nullable: false })
  user: User;

  @Column({ length: 256, nullable: true })
  targetAddress?: string;

  @Column({ length: 256, nullable: true })
  targetBlockchain?: Blockchain;

  @Column({ nullable: true })
  status?: RewardStatus;

  @OneToOne(() => Transaction, { eager: true, nullable: true })
  @JoinColumn()
  transaction?: Transaction;

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

  get isLightningTransaction(): boolean {
    return this.targetBlockchain === Blockchain.LIGHTNING;
  }

  get userData(): UserData {
    return this.user.userData;
  }

  get feeAmountChf(): number {
    return this.amountInChf;
  }

  get isComplete(): boolean {
    return this.status === RewardStatus.COMPLETE;
  }
}
