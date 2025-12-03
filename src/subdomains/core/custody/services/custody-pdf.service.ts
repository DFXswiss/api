import { Injectable, NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import PDFDocument from 'pdfkit';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { BalanceEntry, COINGECKO_PLATFORMS, NATIVE_COIN_IDS, PdfUtil } from 'src/shared/utils/pdf.util';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { PdfLanguage } from 'src/subdomains/supporting/balance/dto/input/get-balance-pdf.dto';
import { AssetPricesService } from 'src/subdomains/supporting/pricing/services/asset-prices.service';
import { CoinGeckoService } from 'src/subdomains/supporting/pricing/services/integration/coin-gecko.service';
import { PriceCurrency } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { In } from 'typeorm';
import { GetCustodyPdfDto } from '../dto/input/get-custody-pdf.dto';
import { CustodyBalanceRepository } from '../repositories/custody-balance.repository';

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

    return PdfUtil.sortBalancesByValue(balances);
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

        PdfUtil.drawLogo(pdf);
        this.drawHeader(pdf, dto, language, verifiedName);
        PdfUtil.drawTable(pdf, balances, dto.currency, language, this.i18n);
        PdfUtil.drawFooter(pdf, totalValue, hasIncompleteData, dto.currency, language, this.i18n);

        pdf.end();
      } catch (e) {
        reject(e);
      }
    });
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
    pdf.text(PdfUtil.translate('custody.title', language, this.i18n), marginX, 75);

    pdf.fontSize(11).font('Helvetica').fillColor('#707070');
    const dateStr = Util.isoDate(dto.date);
    pdf.text(`${PdfUtil.translate('balance.date', language, this.i18n)}: ${dateStr}`, marginX, 105);

    pdf.text(`${PdfUtil.translate('custody.type', language, this.i18n)}: DFX Safe`, marginX, 123);

    if (verifiedName) {
      pdf.text(`${PdfUtil.translate('custody.name', language, this.i18n)}: ${verifiedName}`, marginX, 141);
    }

    const lineY = verifiedName ? 173 : 155;
    pdf
      .moveTo(marginX, lineY)
      .lineTo(width - marginX, lineY)
      .stroke('#072440');

    pdf.y = lineY + 20;
  }
}
