import { Injectable } from '@nestjs/common';
import { Method } from 'axios';
import { Market, mexc, OrderBook, Trade, Transaction } from 'ccxt';
import { Config, GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import {
  Deposit,
  DepositStatus,
  MexcExchangeInfo,
  MexcMyTrade,
  MexcOrderBook,
  MexcSymbol,
  MexcTrade,
  Withdrawal,
  WithdrawalStatus,
} from '../dto/mexc.dto';
import { ExchangeService } from './exchange.service';

@Injectable()
export class MexcService extends ExchangeService {
  protected readonly logger = new DfxLogger(MexcService);

  protected networks: { [b in Blockchain]: string } = {
    Arbitrum: 'ARB',
    BinanceSmartChain: 'BSC',
    Bitcoin: 'BTC',
    Lightning: undefined,
    Spark: undefined,
    Monero: 'XMR',
    Zano: 'ZANO',
    Cardano: undefined,
    DeFiChain: undefined,
    Ethereum: 'ETH',
    Sepolia: undefined,
    Optimism: 'OP',
    Polygon: 'MATIC',
    Base: undefined,
    Gnosis: undefined,
    Haqq: undefined,
    Liquid: undefined,
    Arweave: undefined,
    Railgun: undefined,
    BinancePay: undefined,
    KucoinPay: undefined,
    Solana: 'SOL',
    Tron: 'TRX',
    Citrea: undefined,
    CitreaTestnet: undefined,
    Kraken: undefined,
    Binance: undefined,
    XT: undefined,
    MEXC: undefined,
    MaerkiBaumann: undefined,
    Olkypay: undefined,
    Checkout: undefined,
    Sumixx: undefined,
    Yapeal: undefined,
  };

  constructor(private readonly http: HttpService) {
    super(mexc, GetConfig().mexc);
  }

  // --- OVERRIDES --- //

  get name(): string {
    return 'MEXC';
  }

  async getDeposits(token: string, from: Date): Promise<Transaction[]> {
    const startTime = from.getTime().toString();
    const endTime = new Date().getTime().toString();

    const deposits = await this.request<Deposit[]>('GET', 'capital/deposit/hisrec', {
      startTime,
      endTime,
      coin: token,
    });

    return deposits.map((d) => ({
      info: { ...d },
      id: d.transHash,
      txid: d.transHash,
      timestamp: d.insertTime,
      datetime: new Date(d.insertTime).toISOString(),
      address: d.address,
      addressFrom: undefined,
      addressTo: undefined,
      tag: d.addressTag,
      tagFrom: undefined,
      tagTo: undefined,
      type: 'deposit',
      amount: parseFloat(d.amount),
      currency: d.coin.split('-')[0],
      status: [DepositStatus.INVALID, DepositStatus.REJECTED].includes(d.status)
        ? 'failed'
        : [DepositStatus.SUCCESS, DepositStatus.COMPLETED].includes(d.status)
          ? 'ok'
          : 'pending',
      updated: undefined,
      fee: undefined,
      network: d.network,
      comment: d.memo,
      internal: undefined,
    }));
  }

  async getWithdrawals(token: string, from: Date): Promise<Transaction[]> {
    const startTime = from.getTime().toString();
    const endTime = new Date().getTime().toString();

    const withdrawals = await this.request<Withdrawal[]>('GET', 'capital/withdraw/history', {
      startTime,
      endTime,
      coin: token,
    });

    return withdrawals.map((d) => ({
      info: { ...d },
      id: d.id,
      txid: d.transHash,
      timestamp: d.applyTime,
      datetime: new Date(d.applyTime).toISOString(),
      address: d.address,
      addressFrom: undefined,
      addressTo: undefined,
      tag: undefined,
      tagFrom: undefined,
      tagTo: undefined,
      type: 'withdrawal',
      amount: parseFloat(d.amount),
      currency: d.coin.split('-')[0],
      status: [WithdrawalStatus.FAILED, WithdrawalStatus.CANCEL].includes(d.status)
        ? 'failed'
        : [WithdrawalStatus.SUCCESS].includes(d.status)
          ? 'ok'
          : 'pending',
      updated: undefined,
      fee: d.transactionFee ? { cost: parseFloat(d.transactionFee), currency: d.coin.split('-')[0] } : undefined,
      network: d.network,
      comment: d.memo,
      internal: undefined,
    }));
  }

  async getWithdraw(id: string, token: string): Promise<Transaction | undefined> {
    const withdrawals = await this.getWithdrawals(token, Util.hoursBefore(24));
    return withdrawals.find((w) => w.id === id);
  }

  // --- HELPER METHODS --- //
  private readonly baseUrl = 'https://api.mexc.com/api/v3';

  private async request<T>(method: Method, path: string, params: Record<string, string>): Promise<T> {
    params.timestamp = Date.now().toString();

    const searchParams = new URLSearchParams(params);

    searchParams.set('signature', Util.createHmac(Config.mexc.secret, searchParams.toString()));

    const url = `${this.baseUrl}/${path}?${searchParams}`;

    return this.http.request<T>({
      url,
      method,
      headers: { 'X-MEXC-APIKEY': Config.mexc.apiKey, 'Content-Type': 'application/json' },
    });
  }

  // --- ZCHF Assessment Period - can be removed once assessment ends --- //

  protected async fetchMarkets(): Promise<Market[]> {
    const data = await this.request<MexcExchangeInfo>('GET', 'exchangeInfo', {});
    return data.symbols.map((s) => this.toMarket(s));
  }

  private toMarket(symbol: MexcSymbol): Market {
    return {
      id: symbol.symbol,
      symbol: `${symbol.baseAsset}/${symbol.quoteAsset}`,
      base: symbol.baseAsset,
      quote: symbol.quoteAsset,
      baseId: symbol.baseAsset,
      quoteId: symbol.quoteAsset,
      active: symbol.status === '1' && symbol.isSpotTradingAllowed,
      type: 'spot',
      spot: true,
      margin: symbol.isMarginTradingAllowed,
      swap: false,
      future: false,
      option: false,
      contract: false,
      settle: undefined,
      settleId: undefined,
      contractSize: undefined,
      linear: undefined,
      inverse: undefined,
      expiry: undefined,
      expiryDatetime: undefined,
      strike: undefined,
      optionType: undefined,
      taker: parseFloat(symbol.takerCommission),
      maker: parseFloat(symbol.makerCommission),
      percentage: true,
      tierBased: false,
      feeSide: 'get',
      precision: {
        amount: this.parsePrecision(symbol.baseAssetPrecision),
        price: this.parsePrecision(symbol.quoteAssetPrecision),
      },
      limits: {
        amount: { min: parseFloat(symbol.baseSizePrecision), max: undefined },
        price: { min: undefined, max: undefined },
        cost: { min: parseFloat(symbol.quoteAmountPrecision), max: parseFloat(symbol.maxQuoteAmount) },
        leverage: { min: undefined, max: undefined },
      },
      created: undefined,
      info: symbol,
    } as Market;
  }

  protected async fetchOrderBook(pair: string): Promise<OrderBook> {
    const symbol = pair.replace('/', '');
    const data = await this.request<MexcOrderBook>('GET', 'depth', { symbol });

    return {
      symbol: pair,
      bids: data.bids.map(([price, amount]) => [parseFloat(price), parseFloat(amount)]),
      asks: data.asks.map(([price, amount]) => [parseFloat(price), parseFloat(amount)]),
      timestamp: undefined,
      datetime: undefined,
      nonce: data.lastUpdateId,
    };
  }

  protected async fetchTrades(pair: string, limit: number): Promise<Trade[]> {
    const symbol = pair.replace('/', '');
    const data = await this.request<MexcTrade[]>('GET', 'trades', { symbol, limit: limit.toString() });

    return data.map((t) => ({
      id: t.id?.toString(),
      info: t,
      timestamp: t.time,
      datetime: new Date(t.time).toISOString(),
      symbol: pair,
      order: undefined,
      type: undefined,
      side: t.isBuyerMaker ? 'sell' : 'buy',
      takerOrMaker: t.isBuyerMaker ? 'maker' : 'taker',
      price: parseFloat(t.price),
      amount: parseFloat(t.qty),
      cost: parseFloat(t.quoteQty),
      fee: undefined,
      fees: [],
    }));
  }

  private parsePrecision(precision: number): number {
    if (precision === 0) return 1;
    return parseFloat('0.' + '0'.repeat(precision - 1) + '1');
  }

  async getTrades(from: string, to: string, since?: Date): Promise<Trade[]> {
    const pair = await this.getPair(from, to);

    const params: Record<string, string> = { symbol: pair.replace('/', '') };
    if (since) params.startTime = since.getTime().toString();

    const data = await this.request<MexcMyTrade[]>('GET', 'myTrades', params);

    return data.map((t) => ({
      id: t.id?.toString(),
      info: t,
      timestamp: t.time,
      datetime: new Date(t.time).toISOString(),
      symbol: pair,
      order: t.orderId?.toString(),
      type: undefined,
      side: t.isBuyer ? 'buy' : 'sell',
      takerOrMaker: t.isMaker ? 'maker' : 'taker',
      price: parseFloat(t.price),
      amount: parseFloat(t.qty),
      cost: parseFloat(t.quoteQty),
      fee: t.commission ? { cost: parseFloat(t.commission), currency: t.commissionAsset } : undefined,
      fees: t.commission ? [{ cost: parseFloat(t.commission), currency: t.commissionAsset }] : [],
    }));
  }
}
