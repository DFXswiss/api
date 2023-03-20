import { Trade, Transaction } from 'ccxt';
import { ExchangeTxTransactionDto } from '../dto/exchange-tx-transaction.dto';
import { ExchangeTxType } from '../entities/exchange-tx.entity';

export class ExchangeTxMapper {
  static getDeposits(transactions: Transaction[], exchange: string): ExchangeTxTransactionDto[] {
    return transactions
      .filter((d) => d.type === 'deposit')
      .map((d) => ({
        exchange: exchange,
        type: ExchangeTxType.DEPOSIT,
        externalId: d.id,
        externalCreated: d.datetime ? new Date(d.datetime) : null,
        externalUpdated: d.updated ? new Date(d.updated) : null,
        status: d.status,
        originalStatus: 'd.info.status',
        amount: d.amount,
        currency: d.currency,
        feeAmount: d.fee.cost,
        feeCurrency: d.fee.currency,
        method: d.info.method,
        aClass: d.info.aclass,
        asset: d.info.asset,
        // network: d.network,
        address: d.address,
        // addressTo: d.addressTo,
        // addressFrom: d.addressFrom,
        refId: d.info.refid,
        txId: d.txid,
        // tag: d.tag,
        // tagTo: d.tagTo,
        // tagFrom: d.tagFrom,
      }));
  }

  static getWithdrawals(transactions: Transaction[], exchange: string): ExchangeTxTransactionDto[] {
    return transactions
      .filter((w) => w.type === 'withdrawal')
      .map((w) => ({
        exchange: exchange,
        type: ExchangeTxType.WITHDRAWAL,
        externalId: w.id,
        externalCreated: w.datetime ? new Date(w.datetime) : null,
        externalUpdated: w.updated ? new Date(w.updated) : null,
        status: w.status,
        originalStatus: w.info.status,
        amount: w.amount,
        currency: w.currency,
        feeAmount: w.fee.cost,
        feeCurrency: w.fee.currency,
        method: w.info.method,
        aClass: w.info.aclass,
        asset: w.info.asset,
        // network: w.network,
        address: w.address,
        // addressTo: w.addressTo,
        // addressFrom: w.addressFrom,
        refId: w.info.refid,
        txId: w.txid,
        // tag: w.tag,
        // tagTo: w.tagTo,
        // tagFrom: w.tagFrom,
      }));
  }

  static getTrades(trade: Trade[], exchange: string): ExchangeTxTransactionDto[] {
    return trade.map((t) => ({
      exchange: exchange,
      type: ExchangeTxType.TRADE,
      externalId: t.id,
      externalCreated: t.datetime ? new Date(t.datetime) : null,
      status: 'ok',
      amount: t.amount,
      cost: t.cost,
      feeAmount: t.fee.cost,
      feeCurrency: t.fee.currency,
      order: t.order,
      orderTxId: t.info.ordertxid,
      posTxId: t.info.postxid,
      pair: t.info.pair,
      orderType: t.info.ordertype,
      price: t.price,
      vol: t.info.vol,
      margin: t.info.margin,
      leverage: t.info.leverage,
      misc: t.info.misc,
      tradeId: t.info.trade_id,
      symbol: t.symbol,
      side: t.side,
      takeOrMaker: t.takerOrMaker,
    }));
  }
}
