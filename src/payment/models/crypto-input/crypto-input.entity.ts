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
  field1?: string;

  @Column({ length: 256, nullable: true })
  field2?: string;

  @Column({ length: 256, nullable: true })
  field3?: string;

  @Column({ length: 256, nullable: true })
  field4?: string;

  @Column({ length: 256, nullable: true })
  field5?: string;

  @Column({ length: 256, nullable: true })
  field6?: string;

  @Column({ length: 256, nullable: true })
  field7?: string;

  @Column({ length: 256, nullable: true })
  field8?: string;

  @Column({ length: 256, nullable: true })
  field9?: string;

  @Column({ length: 256, nullable: true })
  field10?: string;

  @Column({ length: 256, nullable: true })
  field11?: string;

  @Column({ length: 256, nullable: true })
  field12?: string;

  @Column({ length: 256, nullable: true })
  field13?: string;

  @Column({ length: 256, nullable: true })
  field14?: string;

  @Column({ length: 256, nullable: true })
  field15?: string;

  @Column({ length: 256, nullable: true })
  field16?: string;

  @Column({ length: 256, nullable: true })
  field17?: string;

  @Column({ length: 256, nullable: true })
  field18?: string;

  @Column({ length: 256, nullable: true })
  field19?: string;

  @Column({ length: 256, nullable: true })
  field20?: string;

  @Column({ length: 256, nullable: true })
  field21?: string;

  @Column({ length: 256, nullable: true })
  field22?: string;

  @Column({ length: 256, nullable: true })
  field23?: string;

  @Column({ length: 256, nullable: true })
  field24?: string;

  @Column({ length: 256, nullable: true })
  field25?: string;

  @Column({ length: 256, nullable: true })
  field26?: string;

  @Column({ length: 256, nullable: true })
  field27?: string;

  @Column({ length: 256, nullable: true })
  field28?: string;

  @Column({ length: 256, nullable: true })
  field29?: string;

  @Column({ length: 256, nullable: true })
  field30?: string;
}
