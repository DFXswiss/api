import { Injectable, NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import PDFDocument from 'pdfkit';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Util } from 'src/shared/utils/util';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { PdfLanguage } from 'src/subdomains/supporting/balance/dto/input/get-balance-pdf.dto';
import { PriceCurrency } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { In } from 'typeorm';
import { GetCustodyPdfDto } from '../dto/input/get-custody-pdf.dto';
import { CustodyAssetBalanceDto } from '../dto/output/custody-balance.dto';
import { CustodyAssetBalanceDtoMapper } from '../mappers/custody-asset-balance-dto.mapper';
import { CustodyBalanceRepository } from '../repositories/custody-balance.repository';

// DFX Logo SVG Paths
const dfxLogoBall1 =
  'M86.1582 126.274C109.821 126.274 129.004 107.092 129.004 83.4287C129.004 59.7657 109.821 40.583 86.1582 40.583C62.4952 40.583 43.3126 59.7657 43.3126 83.4287C43.3126 107.092 62.4952 126.274 86.1582 126.274Z';

const dfxLogoBall2 =
  'M47.1374 132.146C73.1707 132.146 94.2748 111.042 94.2748 85.009C94.2748 58.9757 73.1707 37.8716 47.1374 37.8716C21.1041 37.8716 0 58.9757 0 85.009C0 111.042 21.1041 132.146 47.1374 132.146Z';

const dfxLogoText =
  'M61.5031 0H124.245C170.646 0 208.267 36.5427 208.267 84.0393C208.267 131.536 169.767 170.018 122.288 170.018H61.5031V135.504H114.046C141.825 135.504 164.541 112.789 164.541 85.009C164.541 57.2293 141.825 34.5136 114.046 34.5136H61.5031V0ZM266.25 31.5686V76.4973H338.294V108.066H266.25V170H226.906V0H355.389V31.5686H266.25ZM495.76 170L454.71 110.975L414.396 170H369.216L432.12 83.5365L372.395 0H417.072L456.183 55.1283L494.557 0H537.061L477.803 82.082L541.191 170H495.778H495.76Z';

@Injectable()
export class CustodyPdfService {
  constructor(
    private readonly userDataService: UserDataService,
    private readonly custodyBalanceRepo: CustodyBalanceRepository,
    private readonly i18n: I18nService,
  ) {}

  async generateCustodyPdf(accountId: number, dto: GetCustodyPdfDto): Promise<string> {
    const account = await this.userDataService.getUserData(accountId, { users: true });
    if (!account) throw new NotFoundException('User not found');

    const custodyUserIds = account.users.filter((u) => u.role === UserRole.CUSTODY).map((u) => u.id);
    if (custodyUserIds.length === 0) throw new NotFoundException('No custody accounts found');

    const custodyBalances = await this.custodyBalanceRepo.findBy({ user: { id: In(custodyUserIds) } });
    const balances = CustodyAssetBalanceDtoMapper.mapCustodyBalances(custodyBalances);

    const totalValue = this.getTotalValue(balances, dto.currency);

    return this.createPdf(balances, totalValue, dto);
  }

  private getTotalValue(balances: CustodyAssetBalanceDto[], currency: PriceCurrency): number {
    switch (currency) {
      case PriceCurrency.CHF:
        return balances.reduce((sum, b) => sum + b.value.chf, 0);
      case PriceCurrency.EUR:
        return balances.reduce((sum, b) => sum + b.value.eur, 0);
      case PriceCurrency.USD:
        return balances.reduce((sum, b) => sum + b.value.usd, 0);
    }
  }

  private createPdf(balances: CustodyAssetBalanceDto[], totalValue: number, dto: GetCustodyPdfDto): Promise<string> {
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
