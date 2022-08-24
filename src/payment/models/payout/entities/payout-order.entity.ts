import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';

export enum PayoutOrderContext {
  BUY_CRYPTO = 'BuyCrypto',
  STAKING_REWARD = 'StakingReward',
}

export enum PayoutOrderStatus {
  CREATED = 'Created',
  PREPARATION_PENDING = 'PreparationPending',
  PREPARATION_CONFIRMED = 'PreparationConfirmed',
  PAYOUT_DESIGNATED = 'PayoutDesignated',
  PAYOUT_UNCERTAIN = 'PayoutUncertain',
  PAYOUT_PENDING = 'PayoutPending',
  COMPLETE = 'Complete',
}

@Entity()
export class PayoutOrder extends IEntity {
  @Column({ length: 256, nullable: false })
  context: PayoutOrderContext;

  @Column({ length: 256, nullable: false })
  correlationId: string;

  @Column({ length: 256, nullable: false })
  chain: string;

  @ManyToOne(() => Asset, { eager: true, nullable: false })
  asset: Asset;

  @Column({ type: 'float', nullable: false })
  amount: number;

  @Column({ length: 256, nullable: false })
  destinationAddress: string;

  @Column({ length: 256, nullable: false })
  status: PayoutOrderStatus;

  @Column({ length: 256, nullable: true })
  transferTxId: string;

  @Column({ length: 256, nullable: true })
  payoutTxId: string;

  pendingPreparation(transferTxId: string): this {
    this.transferTxId = transferTxId;
    this.status = PayoutOrderStatus.PREPARATION_PENDING;

    return this;
  }

  preparationConfirmed(): this {
    this.status = PayoutOrderStatus.PREPARATION_CONFIRMED;

    return this;
  }

  designatePayout(): this {
    this.status = PayoutOrderStatus.PAYOUT_DESIGNATED;

    return this;
  }

  pendingInvestigation(): this {
    this.status = PayoutOrderStatus.PAYOUT_UNCERTAIN;

    return this;
  }

  pendingPayout(payoutTxId: string) {
    this.payoutTxId = payoutTxId;
    this.status = PayoutOrderStatus.PAYOUT_PENDING;

    return this;
  }

  complete(): this {
    this.status = PayoutOrderStatus.COMPLETE;

    return this;
  }
}
