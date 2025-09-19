import { Injectable } from '@nestjs/common';
import { Transaction, WithdrawalResponse, xt } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { ExchangeService } from './exchange.service';

@Injectable()
export class XtService extends ExchangeService {
  protected readonly logger = new DfxLogger(XtService);

  protected networks: { [b in Blockchain]: string } = {
    Arbitrum: undefined,
    BinanceSmartChain: 'BNB Smart Chain',
    Bitcoin: undefined,
    Lightning: undefined,
    Spark: undefined,
    Monero: undefined,
    Zano: undefined,
    Cardano: undefined,
    DeFiChain: undefined,
    Ethereum: 'Ethereum',
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

  constructor() {
    super(xt, GetConfig().xt);
  }

  async getDeposits(token: string, since?: Date, chain?: string): Promise<Transaction[]> {
    return this.callApi((e) => e.fetchDeposits(token, this.toCcxtDate(since), 200, { limit: 200, chain }));
  }

  async withdrawFunds(
    token: string,
    amount: number,
    address: string,
    _key: string,
    chain?: string,
  ): Promise<WithdrawalResponse> {
    return this.callApi((e) => e.withdraw(token, amount, address, undefined, { chain }));
  }
}
