import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index } from 'typeorm';

export enum ExchangeTxType {
  WITHDRAWAL = 'Withdrawal',
  DEPOSIT = 'Deposit',
  TRADE = 'Trade',
}

@Entity()
export class ExchangeTx extends IEntity {
  @Column({ length: 256 })
  exchange: string;

  @Column({ length: 256 })
  info: string;

  @Column({ length: 256 })
  type: ExchangeTxType;

  @Column({ length: 256, nullable: true })
  method: string;

  @Column({ length: 256, nullable: true })
  aclass: string;

  @Column({ length: 256, nullable: true })
  asset: string;

  @Column({ length: 256, nullable: true })
  refid: string;

  @Column({ length: 256, nullable: true })
  txid: string;

  @Column({ type: 'float' })
  amount: number;

  @Column({ type: 'float' })
  fee: number;

  @Column({ length: 256, nullable: true })
  status: string;

  @Column({ length: 256 })
  externalId: string;

  @Column({ length: 256 })
  currency: string;

  @Column({ length: 256, nullable: true })
  network: string;

  @Column({ length: 256, nullable: true })
  address: string;

  @Column({ length: 256, nullable: true })
  addressTo: string;

  @Column({ length: 256, nullable: true })
  addressFrom: string;

  @Column({ length: 256, nullable: true })
  tag: string;

  @Column({ length: 256, nullable: true })
  tagTo: string;

  @Column({ length: 256, nullable: true })
  tagFrom: string;

  @Column({ type: 'datetime2', nullable: true })
  externalUpdated: Date;

  @Column({ type: 'datetime2' })
  timestamp: Date;

  @Column({ type: 'datetime2' })
  dateTime: Date;

  @Column({ type: 'float' })
  cost: number;

  @Column({ length: 256, nullable: true })
  order: string;

  @Column({ length: 256, nullable: true })
  orderTxid: string;

  @Column({ length: 256, nullable: true })
  posTxid: string;

  @Column({ length: 256, nullable: true })
  pair: string;

  @Column({ length: 256, nullable: true })
  ordertype: string;

  @Column({ type: 'float', nullable: true })
  price: number;

  @Column({ type: 'float', nullable: true })
  vol: number;

  @Column({ type: 'float', nullable: true })
  margin: number;

  @Column({ type: 'float', nullable: true })
  leverage: number;

  @Column({ length: 256, nullable: true })
  misc: string;

  @Column({ length: 256, nullable: true })
  tradeId: string;

  @Column({ length: 256, nullable: true })
  symbol: string;

  @Column({ length: 256, nullable: true })
  side: string;

  @Column({ length: 256, nullable: true })
  takeOrMaker: string;

  @Column({ type: 'float', nullable: true })
  fees: number;
}
