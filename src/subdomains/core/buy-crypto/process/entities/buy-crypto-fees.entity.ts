import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
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
  estimatePurchaseFeeAmount: number;

  @Column({ type: 'float', nullable: true })
  estimatePurchaseFeePercent: number;

  @Column({ type: 'float', nullable: true })
  estimatePayoutFeeAmount: number;

  @Column({ type: 'float', nullable: true })
  estimatePayoutFeePercent: number;

  @Column({ type: 'float', nullable: true })
  actualPurchaseFeeAmount: number;

  @Column({ type: 'float', nullable: true })
  actualPurchaseFeePercent: number;

  @Column({ type: 'float', nullable: true })
  actualPayoutFeeAmount: number;

  @Column({ type: 'float', nullable: true })
  actualPayoutFeePercent: number;

  //*** FACTORY METHODS ***//

  static create(
    estimatePurchaseFeeAmount: number | null,
    estimatePayoutFeeAmount: number | null,
    transaction: BuyCrypto,
  ): BuyCryptoFee {
    const entity = new BuyCryptoFee();

    entity.buyCrypto = transaction;
    entity.feeReferenceAsset = transaction.outputReferenceAsset;

    entity.estimatePurchaseFeeAmount = estimatePurchaseFeeAmount;
    entity.estimatePurchaseFeePercent =
      estimatePurchaseFeeAmount != null
        ? Util.round(estimatePurchaseFeeAmount / transaction.outputReferenceAmount, 8)
        : null;

    entity.estimatePayoutFeeAmount = estimatePayoutFeeAmount;
    entity.estimatePayoutFeePercent =
      estimatePayoutFeeAmount != null
        ? Util.round(estimatePayoutFeeAmount / transaction.outputReferenceAmount, 8)
        : null;

    return entity;
  }

  //*** PUBLIC API ***//

  addActualPurchaseFee(purchaseFeeAmount: number | null, transaction: BuyCrypto): this {
    if (purchaseFeeAmount == null) {
      this.actualPurchaseFeeAmount = null;
      this.actualPurchaseFeePercent = null;
    } else {
      this.actualPurchaseFeeAmount = purchaseFeeAmount;
      this.actualPurchaseFeePercent = Util.round(purchaseFeeAmount / transaction.outputReferenceAmount, 8);
    }

    return this;
  }

  addActualPayoutFee(payoutFeeAmount: number | null, transaction: BuyCrypto): this {
    if (payoutFeeAmount == null) {
      this.actualPayoutFeeAmount = null;
      this.actualPayoutFeePercent = null;
    } else {
      this.actualPayoutFeeAmount = payoutFeeAmount;
      this.actualPayoutFeePercent = Util.round(payoutFeeAmount / transaction.outputReferenceAmount, 8);
    }

    return this;
  }
}
