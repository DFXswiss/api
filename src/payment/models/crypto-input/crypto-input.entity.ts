import { Asset } from 'src/shared/models/asset/asset.entity';
import { DepositRoute } from 'src/payment/models/route/deposit-route.entity';
import { Sell } from 'src/payment/models/sell/sell.entity';
import { Staking } from 'src/payment/models/staking/staking.entity';
import { Entity, Column, ManyToOne, Index } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';

@Entity()
@Index('txAssetRoute', (input: CryptoInput) => [input.inTxId, input.asset, input.route], { unique: true })
export class CryptoInput extends IEntity {
  @Column({ length: 256 })
  inTxId: string;

  @Column({ length: 256 })
  outTxId: string;

  @Column({ type: 'integer' })
  blockHeight: number;

  @Column({ type: 'float' })
  amount: number;

  @Column({ type: 'float', nullable: true })
  btcAmount?: number;

  @Column({ type: 'float', nullable: true })
  usdtAmount?: number;

  @ManyToOne(() => Asset, { nullable: false, eager: true })
  asset: Asset;

  @ManyToOne(() => DepositRoute, { nullable: false })
  route: Sell | Staking;

  @Column({ default: false })
  isConfirmed: boolean;

  @Column({ default: false })
  isPayback: boolean;
}
