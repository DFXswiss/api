import { Asset } from 'src/shared/models/asset/asset.entity';
import { Sell } from 'src/user/models/sell/sell.entity';
import { Entity, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Column, ManyToOne, Index } from 'typeorm';

@Entity()
@Index('txAssetSell', (input: CryptoInput) => [input.inTxId, input.asset, input.sell], { unique: true })
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

  @ManyToOne(() => Sell, { nullable: false })
  sell: Sell;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
