import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { baseUnitsTransformer } from 'src/shared/models/base-units.transformer';
import { UpdateResult } from 'src/shared/models/entity';
import { LiquidityManagementPipeline } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-pipeline.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
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
  @Index()
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

  @OneToOne(() => Transaction, { nullable: true })
  @JoinColumn()
  sourceTransaction?: Transaction;

  @Index()
  @ManyToOne(() => LiquidityManagementPipeline, { nullable: true })
  liquidityPipeline?: LiquidityManagementPipeline;

  // §2.3 native-first exactness (issue #4287 stage 4): the EXACT integer base units of `outputAmount` — the
  // referral reward actually delivered on-chain — propagated verbatim from the linked REF_PAYOUT payout_order's
  // broadcast value (payout_order.amountBaseUnits, stage 1) at the output asset's own scale, captured at payout
  // completion. Nullable + additive — a chain that does not capture broadcast base units (or an incomplete/legacy
  // row) stays NULL and the existing float `outputAmount` (inherited from Reward) is untouched (fail-open).
  // numeric ↔ JS bigint via baseUnitsTransformer.
  @Column({ type: 'numeric', nullable: true, transformer: baseUnitsTransformer })
  outputAmountBaseUnits?: bigint | null;

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

  complete(payoutTxId: string, outputAmountBaseUnits?: bigint | null): UpdateResult<RefReward> {
    const update: Partial<RefReward> = {
      txId: payoutTxId,
      outputDate: new Date(),
      status: RewardStatus.COMPLETE,
      // §2.3 native-first exactness (#4287 stage 4): the EXACT integer base units actually delivered on-chain,
      // copied from the linked REF_PAYOUT payout_order's broadcast value (stage 1); fail-open null when the
      // chain/row did not capture it.
      outputAmountBaseUnits: outputAmountBaseUnits ?? null,
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
