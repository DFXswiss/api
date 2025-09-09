import { Injectable } from '@nestjs/common';
import { Method } from 'axios';
import { mexc, Transaction } from 'ccxt';
import { Config, GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { Deposit, DepositStatus } from '../dto/mexc.dto';
import { ExchangeService } from './exchange.service';

@Injectable()
export class MexcService extends ExchangeService {
  protected readonly logger = new DfxLogger(MexcService);

  protected networks: { [b in Blockchain]: string } = {
    Arbitrum: undefined,
    BinanceSmartChain: undefined,
    Bitcoin: undefined,
    Lightning: undefined,
    Monero: 'XMR',
    Zano: 'ZANO',
    Cardano: undefined,
    DeFiChain: undefined,
    Ethereum: undefined,
    Sepolia: undefined,
    Optimism: undefined,
    Polygon: undefined,
    Base: undefined,
    Gnosis: undefined,
    Haqq: undefined,
    Liquid: undefined,
    Arweave: undefined,
    Railgun: undefined,
    BinancePay: undefined,
    KucoinPay: undefined,
    Solana: undefined,
    Tron: undefined,
    CitreaTestnet: undefined,
    Kraken: undefined,
    Binance: undefined,
    XT: undefined,
    MEXC: undefined,
    MaerkiBaumann: undefined,
    Olkypay: undefined,
    Checkout: undefined,
    Kaleido: undefined,
    Sumixx: undefined,
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
      status: d.status === DepositStatus.INVALID ? 'failed' : d.status === DepositStatus.PENDING ? 'pending' : 'ok',
      updated: undefined,
      fee: undefined,
      network: d.network,
      comment: d.memo,
      internal: undefined,
    }));
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
}
