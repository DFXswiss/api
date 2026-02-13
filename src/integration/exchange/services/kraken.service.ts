import { Inject, Injectable } from '@nestjs/common';
import { kraken, Order, TradingFeeInterface } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ExchangeTradingFeeDto } from 'src/shared/models/setting/dto/exchange-trading-fee.dto';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { ExchangeName } from '../enums/exchange.enum';
import { ExchangeService } from './exchange.service';

@Injectable()
export class KrakenService extends ExchangeService {
  protected readonly logger = new DfxLogger(KrakenService);

  private static readonly FEE_MAX_AGE_MINUTES = 60;
  private static readonly TRACKED_SYMBOLS = ['BTC/CHF', 'USDT/CHF'];

  // use auto-detect for kraken
  protected networks: { [b in Blockchain]: string | false } = {
    Arbitrum: false,
    BinanceSmartChain: false,
    Bitcoin: false,
    Lightning: undefined,
    Spark: undefined,
    Monero: false,
    Zano: undefined,
    Cardano: false,
    DeFiChain: false,
    Ethereum: false,
    Sepolia: undefined,
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
    Citrea: undefined,
    CitreaTestnet: undefined,
    BitcoinTestnet4: undefined,
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

  @Inject() private readonly settingService: SettingService;

  constructor() {
    super(kraken, GetConfig().kraken);
  }

  // Override trade to ensure ALL trading fees are up-to-date before each trade
  protected async trade(from: string, to: string, amount: number): Promise<string> {
    await this.ensureAllTradingFeesUpToDate();
    return super.trade(from, to, amount);
  }

  protected async updateOrderPrice(order: Order, amount: number, price: number): Promise<string> {
    // order ID does not change for Kraken
    return this.callApi((e) => e.editOrder(order.id, order.symbol, order.type, order.side, amount, price)).then(
      () => order.id,
    );
  }

  async getTradingFee(symbol: string): Promise<TradingFeeInterface> {
    return this.callApi((e) => e.fetchTradingFee(symbol));
  }

  // Public getter for other services
  async getKrakenTradingFee(symbol: string): Promise<ExchangeTradingFeeDto | undefined> {
    return this.settingService.getObjCached<ExchangeTradingFeeDto>(this.getTradingFeeKey(symbol));
  }

  private async ensureAllTradingFeesUpToDate(): Promise<void> {
    await Promise.all(KrakenService.TRACKED_SYMBOLS.map((symbol) => this.refreshTradingFeeIfStale(symbol)));
  }

  private async refreshTradingFeeIfStale(symbol: string): Promise<ExchangeTradingFeeDto | undefined> {
    const key = this.getTradingFeeKey(symbol);
    const current = await this.settingService.getObj<ExchangeTradingFeeDto>(key);

    if (current && !this.isStale(current.updated)) {
      return current;
    }

    try {
      const fee = await this.getTradingFee(symbol);
      const newFee: ExchangeTradingFeeDto = {
        exchange: ExchangeName.KRAKEN,
        symbol: fee.symbol,
        maker: fee.maker,
        taker: fee.taker,
        percentage: fee.percentage,
        tierBased: fee.tierBased,
        updated: new Date().toISOString(),
      };

      if (current?.maker !== newFee.maker || current?.taker !== newFee.taker) {
        this.logger.info(
          `Kraken trading fee for ${symbol} changed: maker ${current?.maker ?? 'N/A'} -> ${newFee.maker}, taker ${current?.taker ?? 'N/A'} -> ${newFee.taker}`,
        );
      }

      await this.settingService.setObj(key, newFee);
      return newFee;
    } catch (e) {
      this.logger.warn(`Failed to refresh trading fee for ${symbol}, using cached value:`, e);
      return current;
    }
  }

  private getTradingFeeKey(symbol: string): string {
    return `krakenTradingFee:${symbol}`;
  }

  private isStale(updated: string): boolean {
    const updatedDate = new Date(updated);
    if (isNaN(updatedDate.getTime())) return true; // Treat invalid date as stale
    const ageMinutes = (Date.now() - updatedDate.getTime()) / 1000 / 60;
    return ageMinutes > KrakenService.FEE_MAX_AGE_MINUTES;
  }
}
