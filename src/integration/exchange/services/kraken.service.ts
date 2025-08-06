import { Injectable } from '@nestjs/common';
import { kraken, Order } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { ExchangeService } from './exchange.service';

@Injectable()
export class KrakenService extends ExchangeService {
  protected readonly logger = new DfxLogger(KrakenService);

  // use auto-detect for kraken
  protected networks: { [b in Blockchain]: string | false } = {
    Arbitrum: false,
    BinanceSmartChain: false,
    Bitcoin: false,
    Lightning: undefined,
    Monero: false,
    Zano: undefined,
    Cardano: false,
    DeFiChain: false,
    Ethereum: false,
    Optimism: false,
    Polygon: false,
    Base: undefined,
    Gnosis: undefined,
    Haqq: undefined,
    Liquid: undefined,
    Arweave: undefined,
    Railgun: undefined,
    BinancePay: undefined,
    KucoinPay: undefined,
    Solana: false,
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
    super(kraken, GetConfig().kraken);
  }

  protected async updateOrderPrice(order: Order, price: number): Promise<string> {
    // order ID does not change for Kraken
    return this.callApi((e) =>
      e.editOrder(order.id, order.symbol, order.type, order.side, order.remaining, price),
    ).then(() => order.id);
  }
}
