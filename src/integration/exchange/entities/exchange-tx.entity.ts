import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index } from 'typeorm';

export enum ExchangeTxType {
  WITHDRAWAL = 'Withdrawal',
  DEPOSIT = 'Deposit',
  TRADE = 'Trade',
}

@Entity()
@Index((exchangeTx: ExchangeTx) => [exchangeTx.exchange, exchangeTx.type, exchangeTx.externalId], {
  unique: true,
})
export class ExchangeTx extends IEntity {
  @Column({ length: 256 })
  exchange: string;

  @Column({ length: 256 })
  type: ExchangeTxType;

  @Column({ length: 256 })
  externalId: string;

  @Column({ type: 'datetime2', nullable: true })
  externalCreated: Date;

  @Column({ type: 'datetime2', nullable: true })
  externalUpdated: Date;

  @Column({ length: 256, nullable: true })
  status: string;

  @Column({ length: 256, nullable: true })
  originalStatus: string;

  @Column({ type: 'float', nullable: true })
  amount: number;

  @Column({ type: 'float', nullable: true })
  feeAmount: number;

  @Column({ length: 256, nullable: true })
  feeCurrency: string;

  // Withdrawal/Deposit

  @Column({ length: 256, nullable: true })
  method: string;

  @Column({ length: 256, nullable: true })
  aClass: string;

  @Column({ length: 256, nullable: true })
  asset: string;

  @Column({ length: 256, nullable: true })
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
  refId: string;

  @Column({ length: 256, nullable: true })
  txId: string;

  @Column({ length: 256, nullable: true })
  tag: string;

  @Column({ length: 256, nullable: true })
  tagTo: string;

  @Column({ length: 256, nullable: true })
  tagFrom: string;

  // Trade
  @Column({ length: 256, nullable: true })
  order: string;

  @Column({ length: 256, nullable: true })
  orderTxId: string;

  @Column({ length: 256, nullable: true })
  posTxId: string;

  @Column({ length: 256, nullable: true })
  pair: string;

  @Column({ length: 256, nullable: true })
  orderType: string;

  @Column({ type: 'float', nullable: true })
  price: number;

  @Column({ type: 'float', nullable: true })
  cost: number;

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
  takerOrMaker: string;
}

export const ExchangeSyncs = ['Kraken'];
export const ExchangeToken = ['BTC', 'EUR', 'CHF', 'USDT', 'USDC', 'LTC', 'ETH', 'USD'];
