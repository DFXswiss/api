import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { BuyCrypto } from './buy-crypto.entity';

@Entity()
export class BuyCryptoFees extends IEntity {
  @OneToOne(() => BuyCrypto, (buyCrypto) => buyCrypto.fees)
  @JoinColumn()
  buyCrypto: BuyCrypto;

  @ManyToOne(() => Asset, { eager: true, nullable: false })
  feeAsset: Asset;

  @Column({ type: 'float', nullable: false })
  estimatePurchaseFeeAmount: number;

  @Column({ type: 'float', nullable: false })
  estimatePurchaseFeePercent: number;

  @Column({ type: 'float', nullable: false })
  estimatePayoutFeeAmount: number;

  @Column({ type: 'float', nullable: false })
  estimatePayoutFeePercent: number;

  @Column({ type: 'float', nullable: false })
  actualPurchaseFeeAmount: number;

  @Column({ type: 'float', nullable: false })
  actualPurchaseFeePercent: number;

  @Column({ type: 'float', nullable: false })
  actualPayoutFeeAmount: number;

  @Column({ type: 'float', nullable: false })
  actualPayoutFeePercent: number;
}
