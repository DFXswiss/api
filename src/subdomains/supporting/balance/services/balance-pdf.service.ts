import { BadRequestException, Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import PDFDocument from 'pdfkit';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Util } from 'src/shared/utils/util';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { AssetPricesService } from '../../pricing/services/asset-prices.service';
import { CoinGeckoService } from '../../pricing/services/integration/coin-gecko.service';
import { FiatCurrency, GetBalancePdfDto, PdfLanguage } from '../dto/input/get-balance-pdf.dto';

interface BalanceEntry {
  asset: Asset;
  balance: number;
  price: number | undefined;
  value: number | undefined;
}

// DFX Logo SVG Paths
const dfxLogoBall1 =
  'M86.1582 126.274C109.821 126.274 129.004 107.092 129.004 83.4287C129.004 59.7657 109.821 40.583 86.1582 40.583C62.4952 40.583 43.3126 59.7657 43.3126 83.4287C43.3126 107.092 62.4952 126.274 86.1582 126.274Z';

const dfxLogoBall2 =
  'M47.1374 132.146C73.1707 132.146 94.2748 111.042 94.2748 85.009C94.2748 58.9757 73.1707 37.8716 47.1374 37.8716C21.1041 37.8716 0 58.9757 0 85.009C0 111.042 21.1041 132.146 47.1374 132.146Z';

const dfxLogoText =
  'M61.5031 0H124.245C170.646 0 208.267 36.5427 208.267 84.0393C208.267 131.536 169.767 170.018 122.288 170.018H61.5031V135.504H114.046C141.825 135.504 164.541 112.789 164.541 85.009C164.541 57.2293 141.825 34.5136 114.046 34.5136H61.5031V0ZM266.25 31.5686V76.4973H338.294V108.066H266.25V170H226.906V0H355.389V31.5686H266.25ZM495.76 170L454.71 110.975L414.396 170H369.216L432.12 83.5365L372.395 0H417.072L456.183 55.1283L494.557 0H537.061L477.803 82.082L541.191 170H495.778H495.76Z';

// Supported EVM blockchains (must have Alchemy support and chainId mapping)
const SUPPORTED_BLOCKCHAINS: Blockchain[] = [
  Blockchain.ETHEREUM,
  Blockchain.BINANCE_SMART_CHAIN,
  Blockchain.POLYGON,
  Blockchain.ARBITRUM,
  Blockchain.OPTIMISM,
  Blockchain.BASE,
  Blockchain.GNOSIS,
];

// Map blockchain to CoinGecko platform ID (only EVM chains supported)
const COINGECKO_PLATFORMS: Partial<Record<Blockchain, string>> = {
  [Blockchain.ETHEREUM]: 'ethereum',
  [Blockchain.BINANCE_SMART_CHAIN]: 'binance-smart-chain',
  [Blockchain.POLYGON]: 'polygon-pos',
  [Blockchain.ARBITRUM]: 'arbitrum-one',
  [Blockchain.OPTIMISM]: 'optimistic-ethereum',
  [Blockchain.BASE]: 'base',
  [Blockchain.GNOSIS]: 'xdai',
};

// Map native coins to CoinGecko IDs
const NATIVE_COIN_IDS: Partial<Record<Blockchain, string>> = {
  [Blockchain.ETHEREUM]: 'ethereum',
  [Blockchain.BINANCE_SMART_CHAIN]: 'binancecoin',
  [Blockchain.POLYGON]: 'matic-network',
  [Blockchain.ARBITRUM]: 'ethereum',
  [Blockchain.OPTIMISM]: 'ethereum',
  [Blockchain.BASE]: 'ethereum',
  [Blockchain.GNOSIS]: 'xdai',
};

@Injectable()
export class BalancePdfService {
  constructor(
    private readonly alchemyService: AlchemyService,
    private readonly assetService: AssetService,
    private readonly assetPricesService: AssetPricesService,
    private readonly coinGeckoService: CoinGeckoService,
    private readonly i18n: I18nService,
  ) {}

  async generateBalancePdf(dto: GetBalancePdfDto): Promise<string> {
    if (!SUPPORTED_BLOCKCHAINS.includes(dto.blockchain)) {
      throw new BadRequestException(
        `Blockchain ${dto.blockchain} is not supported. Supported blockchains: ${SUPPORTED_BLOCKCHAINS.join(', ')}`,
      );
    }

    const balances = await this.getBalancesForAddress(dto.address, dto.blockchain, dto.currency, dto.date);
    const totalValue = balances.reduce((sum, b) => sum + (b.value ?? 0), 0);
    const hasIncompleteData = balances.some((b) => b.value == null);

    return this.createPdf(balances, totalValue, hasIncompleteData, dto);
  }

  private async getBalancesForAddress(
    address: string,
    blockchain: Blockchain,
    currency: FiatCurrency,
    date: Date,
  ): Promise<BalanceEntry[]> {
    const chainId = EvmUtil.getChainId(blockchain);
    const assets = await this.assetService.getAllBlockchainAssets([blockchain]);
    const balances: BalanceEntry[] = [];

    // Find block number for the target date
    const targetTimestamp = Math.floor(date.getTime() / 1000);
    const blockNumber = await this.alchemyService.findBlockByTimestamp(chainId, targetTimestamp);

    // Get native coin balance at historical block
    const nativeCoinBalance = await this.alchemyService.getNativeCoinBalance(chainId, address, blockNumber);
    const nativeCoin = assets.find((a) => !a.chainId);
    if (nativeCoin && nativeCoinBalance) {
      const balance = Number(nativeCoinBalance) / Math.pow(10, 18);
      if (balance > 0) {
        const price = await this.getHistoricalPrice(nativeCoin, blockchain, date, currency);
        balances.push({
          asset: nativeCoin,
          balance,
          price,
          value: price != null ? balance * price : undefined,
        });
      }
    }

    // Get token balances at historical block (parallelized in batches)
    const tokenAssets = assets.filter((a) => a.chainId != null);
    const BATCH_SIZE = 10;

    for (let i = 0; i < tokenAssets.length; i += BATCH_SIZE) {
      const batch = tokenAssets.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (asset) => {
          try {
            const rawBalance = await this.alchemyService.getTokenBalanceAtBlock(
              chainId,
              address,
              asset.chainId,
              blockNumber,
            );
            const balance = Number(rawBalance) / Math.pow(10, asset.decimals ?? 18);
            if (balance > 0) {
              const price = await this.getHistoricalPrice(asset, blockchain, date, currency);
              return {
                asset,
                balance,
                price,
                value: price != null ? balance * price : undefined,
              };
            }
            return null;
          } catch (e) {
            // Skip assets that fail to fetch
            return null;
          }
        }),
      );

      balances.push(...batchResults.filter((b): b is BalanceEntry => b !== null));
    }

    // Sort by value (entries with undefined value go to the end)
    return balances.sort((a, b) => {
      if (a.value == null && b.value == null) return 0;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      return b.value - a.value;
    });
  }

  private async getHistoricalPrice(
    asset: Asset,
    blockchain: Blockchain,
    date: Date,
    currency: FiatCurrency,
  ): Promise<number | undefined> {
    // First, check local database for historical price
    const localPrice = await this.assetPricesService.getAssetPriceForDate(asset.id, date);
    if (localPrice) {
      switch (currency) {
        case FiatCurrency.CHF:
          return localPrice.priceChf;
        case FiatCurrency.EUR:
          return localPrice.priceEur;
        case FiatCurrency.USD:
          return localPrice.priceUsd;
      }
    }

    // Fallback to CoinGecko for historical price
    const currencyLower = currency.toLowerCase() as 'usd' | 'eur' | 'chf';
    const platform = COINGECKO_PLATFORMS[blockchain];

    // For native coins, use coin ID
    if (!asset.chainId) {
      const coinId = NATIVE_COIN_IDS[blockchain];
      if (coinId) {
        return this.coinGeckoService.getHistoricalPrice(coinId, date, currencyLower);
      }
    }

    // For tokens, use contract address
    if (asset.chainId && platform) {
      return this.coinGeckoService.getHistoricalPriceByContract(
        platform,
        asset.chainId,
        date,
        currencyLower,
      );
    }

    return undefined;
  }

  private createPdf(
    balances: BalanceEntry[],
    totalValue: number,
    hasIncompleteData: boolean,
    dto: GetBalancePdfDto,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      try {
        const pdf = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks: Buffer[] = [];
        const language = dto.language ?? PdfLanguage.EN;

        pdf.on('data', (chunk) => chunks.push(chunk));
        pdf.on('end', () => {
          const base64PDF = Buffer.concat(chunks).toString('base64');
          resolve(base64PDF);
        });

        this.drawLogo(pdf);
        this.drawHeader(pdf, dto, language);
        this.drawTable(pdf, balances, dto.currency, language);
        this.drawFooter(pdf, totalValue, hasIncompleteData, dto.currency, language);

        pdf.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  private drawLogo(pdf: InstanceType<typeof PDFDocument>): void {
    pdf.save();
    pdf.translate(50, 30);
    pdf.scale(0.12);

    // Gradient for ball 1
    const gradient1 = pdf.linearGradient(122.111, 64.6777, 45.9618, 103.949);
    gradient1
      .stop(0.04, '#F5516C')
      .stop(0.14, '#C74863')
      .stop(0.31, '#853B57')
      .stop(0.44, '#55324E')
      .stop(0.55, '#382D49')
      .stop(0.61, '#2D2B47');

    // Gradient for ball 2
    const gradient2 = pdf.linearGradient(75.8868, 50.7468, 15.2815, 122.952);
    gradient2.stop(0.2, '#F5516C').stop(1, '#6B3753');

    pdf.path(dfxLogoBall1).fill(gradient1);
    pdf.path(dfxLogoBall2).fill(gradient2);
    pdf.path(dfxLogoText).fill('#072440');
    pdf.restore();
  }

  private drawHeader(pdf: InstanceType<typeof PDFDocument>, dto: GetBalancePdfDto, language: PdfLanguage): void {
    const { width } = pdf.page;
    const marginX = 50;

    // Title (with space after logo)
    pdf.fontSize(20).font('Helvetica-Bold').fillColor('#072440');
    pdf.text(this.translate('balance.title', language), marginX, 75);

    // Date
    pdf.fontSize(11).font('Helvetica').fillColor('#707070');
    const dateStr = Util.isoDate(dto.date);
    pdf.text(`${this.translate('balance.date', language)}: ${dateStr}`, marginX, 105);

    // Blockchain
    pdf.text(`${this.translate('balance.blockchain', language)}: ${dto.blockchain}`, marginX, 123);

    // Address
    pdf.text(`${this.translate('balance.address', language)}: ${dto.address}`, marginX, 141, {
      width: width - marginX * 2,
    });

    // Horizontal line
    pdf.moveTo(marginX, 170).lineTo(width - marginX, 170).stroke('#072440');

    pdf.y = 190;
  }

  private drawTable(
    pdf: InstanceType<typeof PDFDocument>,
    balances: BalanceEntry[],
    currency: FiatCurrency,
    language: PdfLanguage,
  ): void {
    const marginX = 50;
    const { width } = pdf.page;
    const tableWidth = width - marginX * 2;

    const col1Width = tableWidth * 0.3;
    const col2Width = tableWidth * 0.2;
    const col3Width = tableWidth * 0.25;
    const col4Width = tableWidth * 0.25;

    let y = pdf.y + 10;

    // Table header
    pdf.fontSize(11).font('Helvetica-Bold').fillColor('#072440');
    pdf.text(this.translate('balance.table.headers.asset', language), marginX, y);
    pdf.text(this.translate('balance.table.headers.balance', language), marginX + col1Width, y);
    pdf.text(this.translate('balance.table.headers.price', language, { currency }), marginX + col1Width + col2Width, y);
    pdf.text(this.translate('balance.table.headers.value', language, { currency }), marginX + col1Width + col2Width + col3Width, y);

    y += 20;
    pdf.moveTo(marginX, y).lineTo(width - marginX, y).stroke('#CCCCCC');
    y += 10;

    // Table rows
    pdf.fontSize(10).font('Helvetica').fillColor('#333333');

    if (balances.length === 0) {
      pdf.text(this.translate('balance.table.no_assets', language), marginX, y);
      y += 20;
    } else {
      for (const entry of balances) {
        if (y > pdf.page.height - 100) {
          pdf.addPage();
          y = 50;
        }

        pdf.text(entry.asset.name, marginX, y, { width: col1Width - 10 });
        pdf.text(this.formatNumber(entry.balance, 8), marginX + col1Width, y, { width: col2Width - 10 });
        pdf.text(this.formatCurrency(entry.price, currency), marginX + col1Width + col2Width, y, { width: col3Width - 10 });
        pdf.text(this.formatCurrency(entry.value, currency), marginX + col1Width + col2Width + col3Width, y, {
          width: col4Width - 10,
        });

        y += 25;
      }
    }

    pdf.moveTo(marginX, y).lineTo(width - marginX, y).stroke('#CCCCCC');
    pdf.y = y + 10;
  }

  private drawFooter(
    pdf: InstanceType<typeof PDFDocument>,
    totalValue: number,
    hasIncompleteData: boolean,
    currency: FiatCurrency,
    language: PdfLanguage,
  ): void {
    const marginX = 50;
    const { width } = pdf.page;

    let y = pdf.y + 10;

    pdf.fontSize(12).font('Helvetica-Bold').fillColor('#072440');
    pdf.text(`${this.translate('balance.total_value', language)}:`, marginX, y);
    pdf.text(this.formatCurrency(totalValue, currency), width - marginX - 150, y, { width: 150, align: 'right' });

    if (hasIncompleteData) {
      y += 25;
      pdf.fontSize(9).font('Helvetica').fillColor('#707070');
      pdf.text(this.translate('balance.incomplete_data', language), marginX, y);
      y += 15;
    } else {
      y += 25;
    }

    y += 20;
    pdf.fontSize(8).font('Helvetica').fillColor('#999999');
    pdf.text(`${this.translate('balance.generated_by', language)} - ${new Date().toISOString()}`, marginX, y);
  }

  private translate(key: string, language: PdfLanguage, args?: any): string {
    return this.i18n.translate(key, { lang: language.toLowerCase(), args });
  }

  private formatNumber(value: number, decimals: number): string {
    return value.toLocaleString('de-CH', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  }

  private formatCurrency(value: number | undefined, currency: FiatCurrency): string {
    if (value == null) return 'n/a';
    const symbol = currency === FiatCurrency.CHF ? 'CHF' : currency === FiatCurrency.EUR ? '€' : '$';
    return `${symbol} ${value.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
