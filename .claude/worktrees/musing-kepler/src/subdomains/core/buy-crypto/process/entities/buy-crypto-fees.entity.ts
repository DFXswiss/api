import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { BuyCrypto } from './buy-crypto.entity';

@Entity()
export class BuyCryptoFee extends IEntity {
  @OneToOne(() => BuyCrypto, (buyCrypto) => buyCrypto.fee)
  @JoinColumn()
  buyCrypto: BuyCrypto;

  @ManyToOne(() => Asset, { eager: true, nullable: false })
  feeReferenceAsset: Asset;

  @Column({ type: 'float', nullable: true })
  estimatePurchaseFeeAmount?: number;

  @Column({ type: 'float', nullable: true })
  estimatePurchaseFeePercent?: number;

  @Column({ type: 'float', nullable: true })
  estimatePayoutFeeAmount?: number;

  @Column({ type: 'float', nullable: true })
  estimatePayoutFeePercent?: number;

  @Column({ type: 'float', nullable: true })
  actualPurchaseFeeAmount?: number;

  @Column({ type: 'float', nullable: true })
  actualPurchaseFeePercent?: number;

  @Column({ type: 'float', nullable: true })
  actualPayoutFeeAmount?: number;

  @Column({ type: 'float', nullable: true })
  actualPayoutFeePercent?: number;

  @Column({ type: 'float', nullable: true })
  allowedTotalFeeAmount?: number;

  //*** FACTORY METHODS ***//

  static create(transaction: BuyCrypto): BuyCryptoFee {
    const entity = new BuyCryptoFee();

    entity.buyCrypto = transaction;
    entity.feeReferenceAsset = transaction.outputReferenceAsset;

    return entity;
  }

  //*** PUBLIC API ***//

  addPayoutFeeEstimation(estimatedPayoutFeeAmount: number, transaction: BuyCrypto): UpdateResult<BuyCryptoFee> {
    const update: Partial<BuyCryptoFee> = {
      estimatePayoutFeeAmount: estimatedPayoutFeeAmount,
      estimatePayoutFeePercent: Util.round(estimatedPayoutFeeAmount / transaction.outputReferenceAmount, 8),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  addPurchaseFeeEstimation(estimatedPurchaseFeeAmount: number, transaction: BuyCrypto): this {
    this.estimatePurchaseFeeAmount = estimatedPurchaseFeeAmount;
    this.estimatePurchaseFeePercent = Util.round(estimatedPurchaseFeeAmount / transaction.outputReferenceAmount, 8);

    return this;
  }

  addActualPurchaseFee(purchaseFeeAmount: number, transaction: BuyCrypto): this {
    this.actualPurchaseFeeAmount = purchaseFeeAmount;
    this.actualPurchaseFeePercent = Util.round(purchaseFeeAmount / transaction.outputReferenceAmount, 8);

    return this;
  }

  addActualPayoutFee(payoutFeeAmount: number, transaction: BuyCrypto): this {
    this.actualPayoutFeeAmount = payoutFeeAmount;
    this.actualPayoutFeePercent = Util.round(payoutFeeAmount / transaction.outputReferenceAmount, 8);

    return this;
  }
}
