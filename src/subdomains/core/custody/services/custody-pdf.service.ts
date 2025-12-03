import { Injectable, NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import PDFDocument from 'pdfkit';
import { dfxLogoBall1, dfxLogoBall2, dfxLogoText } from 'src/shared/utils/dfx-logo';
import { Util } from 'src/shared/utils/util';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { PdfLanguage } from 'src/subdomains/supporting/balance/dto/input/get-balance-pdf.dto';
import { PriceCurrency } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { GetCustodyPdfDto } from '../dto/input/get-custody-pdf.dto';
import { CustodyAssetBalanceDto, CustodyBalanceDto } from '../dto/output/custody-balance.dto';
import { CustodyService } from './custody.service';

@Injectable()
export class CustodyPdfService {
  constructor(
    private readonly userDataService: UserDataService,
    private readonly custodyService: CustodyService,
    private readonly i18n: I18nService,
  ) {}

  async generateCustodyPdf(accountId: number, dto: GetCustodyPdfDto): Promise<string> {
    const account = await this.userDataService.getUserData(accountId, { language: true });
    if (!account) throw new NotFoundException('User not found');

    const custodyBalance = await this.custodyService.getUserCustodyBalance(accountId);
    if (custodyBalance.balances.length === 0) throw new NotFoundException('No custody balances found');

    const language = this.mapLanguage(account.language?.symbol);
    const totalValue = this.getTotalValue(custodyBalance, dto.currency);

    return this.createPdf(custodyBalance.balances, totalValue, dto, language);
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

  private getTotalValue(balance: CustodyBalanceDto, currency: PriceCurrency): number {
    switch (currency) {
      case PriceCurrency.CHF:
        return balance.totalValue.chf;
      case PriceCurrency.EUR:
        return balance.totalValue.eur;
      case PriceCurrency.USD:
        return balance.totalValue.usd;
    }
  }

  private createPdf(
    balances: CustodyAssetBalanceDto[],
    totalValue: number,
    dto: GetCustodyPdfDto,
    language: PdfLanguage,
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
        this.drawHeader(pdf, dto, language);
        this.drawTable(pdf, balances, dto.currency, language);
        this.drawFooter(pdf, totalValue, dto.currency, language);

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

  private drawHeader(pdf: InstanceType<typeof PDFDocument>, dto: GetCustodyPdfDto, language: PdfLanguage): void {
    const { width } = pdf.page;
    const marginX = 50;

    pdf.fontSize(20).font('Helvetica-Bold').fillColor('#072440');
    pdf.text(this.translate('custody.title', language), marginX, 75);

    pdf.fontSize(11).font('Helvetica').fillColor('#707070');
    const dateStr = Util.isoDate(dto.date);
    pdf.text(`${this.translate('balance.date', language)}: ${dateStr}`, marginX, 105);

    pdf.text(`${this.translate('custody.type', language)}: DFX Safe`, marginX, 123);

    pdf
      .moveTo(marginX, 155)
      .lineTo(width - marginX, 155)
      .stroke('#072440');

    pdf.y = 175;
  }

  private drawTable(
    pdf: InstanceType<typeof PDFDocument>,
    balances: CustodyAssetBalanceDto[],
    currency: PriceCurrency,
    language: PdfLanguage,
  ): void {
    const marginX = 50;
    const { width } = pdf.page;
    const tableWidth = width - marginX * 2;

    const col1Width = tableWidth * 0.4;
    const col2Width = tableWidth * 0.3;
    const col3Width = tableWidth * 0.3;

    let y = pdf.y + 10;

    pdf.fontSize(11).font('Helvetica-Bold').fillColor('#072440');
    pdf.text(this.translate('balance.table.headers.asset', language), marginX, y, { width: col1Width - 10 });
    pdf.text(this.translate('balance.table.headers.balance', language), marginX + col1Width, y, { width: col2Width - 10 });
    pdf.text(this.translate('balance.table.headers.value', language, { currency }), marginX + col1Width + col2Width, y, {
      width: col3Width - 10,
      align: 'right',
    });

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

        const value = this.getValueForCurrency(entry, currency);

        pdf.text(entry.asset.name, marginX, y, { width: col1Width - 10 });
        pdf.text(this.formatNumber(entry.balance, 8), marginX + col1Width, y, { width: col2Width - 10 });
        pdf.text(this.formatCurrency(value, currency), marginX + col1Width + col2Width, y, {
          align: 'right',
          width: col3Width - 10,
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
    currency: PriceCurrency,
    language: PdfLanguage,
  ): void {
    const marginX = 50;
    const { width } = pdf.page;

    let y = pdf.y + 10;

    pdf.fontSize(12).font('Helvetica-Bold').fillColor('#072440');
    pdf.text(`${this.translate('balance.total_value', language)}:`, marginX, y);
    pdf.text(this.formatCurrency(totalValue, currency), width - marginX - 150, y, { width: 150, align: 'right' });

    y += 40;
    pdf.fontSize(8).font('Helvetica').fillColor('#999999');
    pdf.text(`${this.translate('balance.generated_by', language)} - ${new Date().toISOString()}`, marginX, y);
  }

  private getValueForCurrency(entry: CustodyAssetBalanceDto, currency: PriceCurrency): number {
    switch (currency) {
      case PriceCurrency.CHF:
        return entry.value.chf;
      case PriceCurrency.EUR:
        return entry.value.eur;
      case PriceCurrency.USD:
        return entry.value.usd;
    }
  }

  private translate(key: string, language: PdfLanguage, args?: any): string {
    return this.i18n.translate(key, { lang: language.toLowerCase(), args });
  }

  private formatNumber(value: number, decimals: number): string {
    return value.toLocaleString('de-CH', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  }

  private formatCurrency(value: number, currency: PriceCurrency): string {
    const symbol = currency === PriceCurrency.CHF ? 'CHF' : currency === PriceCurrency.EUR ? '€' : '$';
    return `${symbol} ${value.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
