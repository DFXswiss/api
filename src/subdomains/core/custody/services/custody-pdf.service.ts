import { Injectable, NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import PDFDocument from 'pdfkit';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { dfxLogoBall1, dfxLogoBall2, dfxLogoText } from 'src/shared/utils/dfx-logo';
import { Util } from 'src/shared/utils/util';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { PdfLanguage } from 'src/subdomains/supporting/balance/dto/input/get-balance-pdf.dto';
import { AssetPricesService } from 'src/subdomains/supporting/pricing/services/asset-prices.service';
import { CoinGeckoService } from 'src/subdomains/supporting/pricing/services/integration/coin-gecko.service';
import { PriceCurrency } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { In } from 'typeorm';
import { GetCustodyPdfDto } from '../dto/input/get-custody-pdf.dto';
import { CustodyBalanceRepository } from '../repositories/custody-balance.repository';

// Map blockchain to CoinGecko platform ID
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

interface BalanceEntry {
  asset: Asset;
  balance: number;
  price: number | undefined;
  value: number | undefined;
}

@Injectable()
export class CustodyPdfService {
  constructor(
    private readonly userDataService: UserDataService,
    private readonly custodyBalanceRepo: CustodyBalanceRepository,
    private readonly assetPricesService: AssetPricesService,
    private readonly coinGeckoService: CoinGeckoService,
    private readonly i18n: I18nService,
  ) {}

  async generateCustodyPdf(accountId: number, dto: GetCustodyPdfDto): Promise<string> {
    const account = await this.userDataService.getUserData(accountId, { language: true, users: true });
    if (!account) throw new NotFoundException('User not found');

    const balances = await this.getBalancesWithHistoricalPrices(account.users, dto.currency, dto.date);
    if (balances.length === 0) throw new NotFoundException('No custody balances found');

    const language = this.mapLanguage(account.language?.symbol);
    const totalValue = balances.reduce((sum, b) => sum + (b.value ?? 0), 0);
    const hasIncompleteData = balances.some((b) => b.value == null);

    return this.createPdf(balances, totalValue, hasIncompleteData, dto, language, account.verifiedName);
  }

  private async getBalancesWithHistoricalPrices(
    users: { id: number; role: UserRole }[],
    currency: PriceCurrency,
    date: Date,
  ): Promise<BalanceEntry[]> {
    const custodyUserIds = users.filter((u) => u.role === UserRole.CUSTODY).map((u) => u.id);
    const custodyBalances = await this.custodyBalanceRepo.findBy({ user: { id: In(custodyUserIds) } });

    // Group by asset and sum balances
    const balanceMap = new Map<number, { asset: Asset; balance: number }>();
    for (const cb of custodyBalances) {
      const existing = balanceMap.get(cb.asset.id);
      if (existing) {
        existing.balance += cb.balance;
      } else {
        balanceMap.set(cb.asset.id, { asset: cb.asset, balance: cb.balance });
      }
    }

    // Get historical prices for each asset
    const balances: BalanceEntry[] = [];
    for (const { asset, balance } of balanceMap.values()) {
      if (balance <= 0) continue;

      const price = await this.getHistoricalPrice(asset, date, currency);
      balances.push({
        asset,
        balance,
        price,
        value: price != null ? balance * price : undefined,
      });
    }

    // Sort by value (entries with undefined value go to the end)
    return balances.sort((a, b) => {
      if (a.value == null && b.value == null) return 0;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      return b.value - a.value;
    });
  }

  private async getHistoricalPrice(asset: Asset, date: Date, currency: PriceCurrency): Promise<number | undefined> {
    // First, check local database for historical price
    const localPrice = await this.assetPricesService.getAssetPriceForDate(asset.id, date);
    if (localPrice) {
      switch (currency) {
        case PriceCurrency.CHF:
          return localPrice.priceChf;
        case PriceCurrency.EUR:
          return localPrice.priceEur;
        case PriceCurrency.USD:
          return localPrice.priceUsd;
      }
    }

    // Fallback to CoinGecko for historical price
    const currencyLower = currency.toLowerCase() as 'usd' | 'eur' | 'chf';
    const platform = COINGECKO_PLATFORMS[asset.blockchain];

    // For native coins, use coin ID
    if (!asset.chainId) {
      const coinId = NATIVE_COIN_IDS[asset.blockchain];
      if (coinId) {
        return this.coinGeckoService.getHistoricalPrice(coinId, date, currencyLower);
      }
    }

    // For tokens, use contract address
    if (asset.chainId && platform) {
      return this.coinGeckoService.getHistoricalPriceByContract(platform, asset.chainId, date, currencyLower);
    }

    return undefined;
  }

  private mapLanguage(symbol?: string): PdfLanguage {
    switch (symbol?.toUpperCase()) {
      case 'DE':
        return PdfLanguage.DE;
      case 'FR':
        return PdfLanguage.FR;
      case 'IT':
        return PdfLanguage.IT;
      default:
        return PdfLanguage.EN;
    }
  }

  private createPdf(
    balances: BalanceEntry[],
    totalValue: number,
    hasIncompleteData: boolean,
    dto: GetCustodyPdfDto,
    language: PdfLanguage,
    verifiedName?: string,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      try {
        const pdf = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks: Buffer[] = [];

        pdf.on('data', (chunk) => chunks.push(chunk));
        pdf.on('end', () => {
          const base64PDF = Buffer.concat(chunks).toString('base64');
          resolve(base64PDF);
        });

        this.drawLogo(pdf);
        this.drawHeader(pdf, dto, language, verifiedName);
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

    const gradient1 = pdf.linearGradient(122.111, 64.6777, 45.9618, 103.949);
    gradient1
      .stop(0.04, '#F5516C')
      .stop(0.14, '#C74863')
      .stop(0.31, '#853B57')
      .stop(0.44, '#55324E')
      .stop(0.55, '#382D49')
      .stop(0.61, '#2D2B47');

    const gradient2 = pdf.linearGradient(75.8868, 50.7468, 15.2815, 122.952);
    gradient2.stop(0.2, '#F5516C').stop(1, '#6B3753');

    pdf.path(dfxLogoBall1).fill(gradient1);
    pdf.path(dfxLogoBall2).fill(gradient2);
    pdf.path(dfxLogoText).fill('#072440');
    pdf.restore();
  }

  private drawHeader(
    pdf: InstanceType<typeof PDFDocument>,
    dto: GetCustodyPdfDto,
    language: PdfLanguage,
    verifiedName?: string,
  ): void {
    const { width } = pdf.page;
    const marginX = 50;

    pdf.fontSize(20).font('Helvetica-Bold').fillColor('#072440');
    pdf.text(this.translate('custody.title', language), marginX, 75);

    pdf.fontSize(11).font('Helvetica').fillColor('#707070');
    const dateStr = Util.isoDate(dto.date);
    pdf.text(`${this.translate('balance.date', language)}: ${dateStr}`, marginX, 105);

    pdf.text(`${this.translate('custody.type', language)}: DFX Safe`, marginX, 123);

    if (verifiedName) {
      pdf.text(`${this.translate('custody.name', language)}: ${verifiedName}`, marginX, 141);
    }

    const lineY = verifiedName ? 173 : 155;
    pdf
      .moveTo(marginX, lineY)
      .lineTo(width - marginX, lineY)
      .stroke('#072440');

    pdf.y = lineY + 20;
  }

  private drawTable(
    pdf: InstanceType<typeof PDFDocument>,
    balances: BalanceEntry[],
    currency: PriceCurrency,
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

    pdf.fontSize(11).font('Helvetica-Bold').fillColor('#072440');
    pdf.text(this.translate('balance.table.headers.asset', language), marginX, y, { width: col1Width - 10 });
    pdf.text(this.translate('balance.table.headers.balance', language), marginX + col1Width, y, { width: col2Width - 10 });
    pdf.text(this.translate('balance.table.headers.price', language, { currency }), marginX + col1Width + col2Width, y, {
      width: col3Width - 10,
    });
    pdf.text(
      this.translate('balance.table.headers.value', language, { currency }),
      marginX + col1Width + col2Width + col3Width,
      y,
      { width: col4Width - 10, align: 'right' },
    );

    y += 20;
    pdf
      .moveTo(marginX, y)
      .lineTo(width - marginX, y)
      .stroke('#CCCCCC');
    y += 10;

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
        pdf.text(this.formatCurrency(entry.price, currency), marginX + col1Width + col2Width, y, {
          width: col3Width - 10,
        });
        pdf.text(this.formatCurrency(entry.value, currency), marginX + col1Width + col2Width + col3Width, y, {
          align: 'right',
          width: col4Width - 10,
        });

        y += 25;
      }
    }

    pdf
      .moveTo(marginX, y)
      .lineTo(width - marginX, y)
      .stroke('#CCCCCC');
    pdf.y = y + 10;
  }

  private drawFooter(
    pdf: InstanceType<typeof PDFDocument>,
    totalValue: number,
    hasIncompleteData: boolean,
    currency: PriceCurrency,
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

  private formatCurrency(value: number | undefined, currency: PriceCurrency): string {
    if (value == null) return 'n/a';
    const symbol = currency === PriceCurrency.CHF ? 'CHF' : currency === PriceCurrency.EUR ? '€' : '$';
    return `${symbol} ${value.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
