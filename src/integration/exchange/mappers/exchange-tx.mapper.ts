import { Trade, Transaction } from 'ccxt';
import { ExchangeTxDto } from '../dto/exchange-tx.dto';
import { ExchangeTxType } from '../entities/exchange-tx.entity';
import { ExchangeName } from '../enums/exchange.enum';

export class ExchangeTxMapper {
  static mapDeposits(transactions: Transaction[], exchange: ExchangeName): ExchangeTxDto[] {
    return transactions
      .filter((d) => d.type === 'deposit')
      .map((d) => ({
        exchange,
        type: ExchangeTxType.DEPOSIT,
        externalId: d.id,
        externalCreated: d.datetime ? new Date(d.datetime) : null,
        externalUpdated: d.updated ? new Date(d.updated) : null,
        status: d.status,
        amount: d.amount,
        currency: d.currency,
        feeAmount: d.fee?.cost ?? 0,
        feeCurrency: d.fee?.currency,
        method: d.info.method,
        asset: d.info.asset,
        address: d.address,
        txId: d.txid,
      }));
  }

  static mapWithdrawals(transactions: Transaction[], exchange: ExchangeName): ExchangeTxDto[] {
    return transactions
      .filter((w) => w.type === 'withdrawal')
      .map((w) => ({
        exchange,
        type: ExchangeTxType.WITHDRAWAL,
        externalId: w.id,
        externalCreated: w.datetime ? new Date(w.datetime) : null,
        externalUpdated: w.updated ? new Date(w.updated) : null,
        status: w.status,
        amount: w.amount,
        currency: w.currency,
        feeAmount: w.fee?.cost ?? 0,
        feeCurrency: w.fee?.currency,
        method: w.info.method,
        asset: w.info.asset,
        address: w.address,
        txId: w.txid,
      }));
  }

  static mapTrades(trade: Trade[], exchange: ExchangeName): ExchangeTxDto[] {
    return trade.map((t) => ({
      exchange,
      type: ExchangeTxType.TRADE,
      externalId: t.id,
      externalCreated: t.datetime ? new Date(t.datetime) : null,
      externalUpdated: null,
      status: 'ok',
      amount: t.amount,
      cost: t.cost,
      feeAmount: t.fee?.cost ?? 0,
      feeCurrency: t.fee?.currency,
      order: t.order,
      pair: t.info.pair,
      orderType: t.info.ordertype,
      price: t.price,
      vol: t.info.vol,
      margin: t.info.margin,
      leverage: t.info.leverage,
      tradeId: t.info.trade_id,
      symbol: t.symbol,
      side: t.side,
    }));
  }
}
