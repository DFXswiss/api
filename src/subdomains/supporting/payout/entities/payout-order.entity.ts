import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
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
  chain: Blockchain;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
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

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  preparationFeeAsset?: Asset;

  @Column({ type: 'float', nullable: true })
  preparationFeeAmount?: number;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  payoutFeeAsset?: Asset;

  @Column({ type: 'float', nullable: true })
  payoutFeeAmount?: number;

  pendingPreparation(transferTxId: string): this {
    this.transferTxId = transferTxId;
    this.status = PayoutOrderStatus.PREPARATION_PENDING;

    return this;
  }

  preparationConfirmed(): this {
    this.status = PayoutOrderStatus.PREPARATION_CONFIRMED;

    return this;
  }

  recordPreparationFee(preparationFeeAsset: Asset, preparationFeeAmount: number): this {
    this.preparationFeeAsset = preparationFeeAsset;
    this.preparationFeeAmount = preparationFeeAmount;

    return this;
  }

  designatePayout(): this {
    this.status = PayoutOrderStatus.PAYOUT_DESIGNATED;

    return this;
  }

  rollbackPayoutDesignation(): this {
    this.preparationConfirmed();

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

  recordPayoutFee(payoutFeeAsset: Asset, payoutFeeAmount: number): this {
    this.payoutFeeAsset = payoutFeeAsset;
    this.payoutFeeAmount = payoutFeeAmount;

    return this;
  }

  complete(): this {
    this.status = PayoutOrderStatus.COMPLETE;

    return this;
  }

  //*** GETTERS ***//

  get payoutFee(): { asset: Asset; amount: number } {
    return {
      asset: this.payoutFeeAsset,
      amount: Util.round(this.payoutFeeAmount + this.preparationFeeAmount, 8),
    };
  }
}
