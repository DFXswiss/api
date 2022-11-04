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

  @Column({ type: 'float', nullable: false })
  estimatePurchaseFeeAmount: number;

  @Column({ type: 'float', nullable: false })
  estimatePurchaseFeePercent: number;

  @Column({ type: 'float', nullable: false })
  estimatePayoutFeeAmount: number;

  @Column({ type: 'float', nullable: false })
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

  static create(purchaseFeeAmount: number, payoutFeeAmount: number, transaction: BuyCrypto): BuyCryptoFee {
    const entity = new BuyCryptoFee();

    entity.buyCrypto = transaction;
    entity.feeReferenceAsset = transaction.outputReferenceAsset;

    entity.estimatePurchaseFeeAmount = purchaseFeeAmount;
    entity.estimatePurchaseFeePercent = Util.round(purchaseFeeAmount / transaction.outputReferenceAmount, 8);
    entity.estimatePayoutFeeAmount = payoutFeeAmount;
    entity.estimatePayoutFeePercent = Util.round(payoutFeeAmount / transaction.outputReferenceAmount, 8);

    return entity;
  }

  //*** PUBLIC API ***//

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
