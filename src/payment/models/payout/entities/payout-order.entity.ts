import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';

export enum PayoutOrderContext {
  BUY_CRYPTO = 'BuyCrypto',
  STAKING_REWARD = 'StakingReward',
}

export enum PayoutOrderStatus {
  CREATED = 'Created',
  TRANSFER_PENDING = 'TransferPending',
  TRANSFER_CONFIRMED = 'TransferConfirmed',
  PAYOUT_PENDING = 'PayoutPending',
  COMPLETED = 'Completed',
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
  asset: string;

  @Column({ type: 'float', nullable: true })
  amount: number;

  @Column({ length: 256, nullable: false })
  destinationAddress: string;

  @Column({ length: 256, nullable: false })
  status: PayoutOrderStatus;

  @Column({ length: 256, nullable: true })
  transferTxId: string;

  @Column({ length: 256, nullable: true })
  payoutTxId: string;

  @Column({ nullable: false, default: false })
  isAcknowledged: boolean;

  pendingTransfer(transferTxId: string): this {
    this.transferTxId = transferTxId;
    this.status = PayoutOrderStatus.TRANSFER_PENDING;

    return this;
  }

  transferConfirmed(): this {
    this.status = PayoutOrderStatus.TRANSFER_CONFIRMED;

    return this;
  }

  pendingPayout(payoutTxId: string) {
    this.payoutTxId = payoutTxId;
    this.status = PayoutOrderStatus.PAYOUT_PENDING;

    return this;
  }

  complete(): this {
    this.status = PayoutOrderStatus.COMPLETED;

    return this;
  }
}
