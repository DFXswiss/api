import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index } from 'typeorm';

export enum ExchangeTxType {
  WITHDRAWAL = 'Withdrawal',
  DEPOSIT = 'Deposit',
  TRADE = 'Trade',
}

export type ExchangeTxDto = Omit<ExchangeTx, keyof IEntity>;

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

  @Column({ type: 'float', nullable: true })
  amount: number;

  @Column({ type: 'float', nullable: true })
  feeAmount: number;

  @Column({ length: 256, nullable: true })
  feeCurrency: string;

  // Withdrawal/Deposit

  @Column({ length: 256, nullable: true })
  method?: string;

  @Column({ length: 256, nullable: true })
  asset?: string;

  @Column({ length: 256, nullable: true })
  currency?: string;

  @Column({ length: 'MAX', nullable: true })
  address?: string;

  @Column({ length: 256, nullable: true })
  txId?: string;

  // Trade
  @Column({ length: 256, nullable: true })
  order?: string;

  @Column({ length: 256, nullable: true })
  pair?: string;

  @Column({ length: 256, nullable: true })
  orderType?: string;

  @Column({ type: 'float', nullable: true })
  price?: number;

  @Column({ type: 'float', nullable: true })
  cost?: number;

  @Column({ type: 'float', nullable: true })
  vol?: number;

  @Column({ type: 'float', nullable: true })
  margin?: number;

  @Column({ type: 'float', nullable: true })
  leverage?: number;

  @Column({ length: 256, nullable: true })
  tradeId?: string;

  @Column({ length: 256, nullable: true })
  symbol?: string;

  @Column({ length: 256, nullable: true })
  side?: string;
}

export const ExchangeSyncs = ['Kraken'];
export const ExchangeTokens = ['BTC', 'EUR', 'CHF', 'USDT', 'USDC', 'LTC', 'ETH', 'USD'];
