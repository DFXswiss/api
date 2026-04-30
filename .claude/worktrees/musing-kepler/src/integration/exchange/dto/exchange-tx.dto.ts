import { ExchangeTxType } from '../entities/exchange-tx.entity';
import { ExchangeName } from '../enums/exchange.enum';

export class ExchangeTxDto {
  exchange: ExchangeName;
  type: ExchangeTxType;
  externalId: string;
  externalCreated?: Date;
  externalUpdated?: Date;
  status: string;
  amount: number;
  feeAmount: number;
  feeCurrency: string;
  method?: string;
  asset?: string;
  currency?: string;
  address?: string;
  txId?: string;
  order?: string;
  pair?: string;
  orderType?: string;
  price?: number;
  cost?: number;
  vol?: number;
  margin?: number;
  leverage?: number;
  tradeId?: string;
  symbol?: string;
  side?: string;
}
