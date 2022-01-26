import { Asset } from 'src/shared/models/asset/asset.entity';
import { DepositRoute } from 'src/payment/models/route/deposit-route.entity';
import { Sell } from 'src/payment/models/sell/sell.entity';
import { Staking } from 'src/payment/models/staking/staking.entity';
import { Entity, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Column, ManyToOne, Index } from 'typeorm';

@Entity()
@Index('txAssetRoute', (input: CryptoInput) => [input.inTxId, input.asset, input.route], { unique: true })
export class CryptoInput {
  @PrimaryGeneratedColumn()
  id: number;

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

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
