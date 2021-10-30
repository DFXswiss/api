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

  @ManyToOne(() => Asset, { nullable: false, eager: true })
  asset: Asset;

  @ManyToOne(() => Sell, { nullable: false })
  sell: Sell;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;


  // Robin's generic columns
  @Column({ length: 256, nullable: true })
  f1?: string;

  @Column({ length: 256, nullable: true })
  f2?: string;

  @Column({ length: 256, nullable: true })
  f3?: string;

  @Column({ length: 256, nullable: true })
  f4?: string;

  @Column({ length: 256, nullable: true })
  f5?: string;

  @Column({ length: 256, nullable: true })
  f6?: string;

  @Column({ length: 256, nullable: true })
  f7?: string;

  @Column({ length: 256, nullable: true })
  f8?: string;

  @Column({ length: 256, nullable: true })
  f9?: string;

  @Column({ length: 256, nullable: true })
  f10?: string;

  @Column({ length: 256, nullable: true })
  f11?: string;

  @Column({ length: 256, nullable: true })
  f12?: string;

  @Column({ length: 256, nullable: true })
  f13?: string;

  @Column({ length: 256, nullable: true })
  f14?: string;

  @Column({ length: 256, nullable: true })
  f15?: string;

  @Column({ length: 256, nullable: true })
  f16?: string;

  @Column({ length: 256, nullable: true })
  f17?: string;

  @Column({ length: 256, nullable: true })
  f18?: string;

  @Column({ length: 256, nullable: true })
  f19?: string;

  @Column({ length: 256, nullable: true })
  f20?: string;

  @Column({ length: 256, nullable: true })
  f21?: string;

  @Column({ length: 256, nullable: true })
  f22?: string;

  @Column({ length: 256, nullable: true })
  f23?: string;

  @Column({ length: 256, nullable: true })
  f24?: string;

  @Column({ length: 256, nullable: true })
  f25?: string;

  @Column({ length: 256, nullable: true })
  f26?: string;

  @Column({ length: 256, nullable: true })
  f27?: string;

  @Column({ length: 256, nullable: true })
  f28?: string;

  @Column({ length: 256, nullable: true })
  f29?: string;

  @Column({ length: 256, nullable: true })
  f30?: string;
}
