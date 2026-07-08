import { I18nService } from 'nestjs-i18n';
import PDFDocument from 'pdfkit';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PdfLanguage } from 'src/subdomains/supporting/balance/dto/input/get-balance-pdf.dto';
import { PriceCurrency } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { mm2pt } from 'swissqrbill/utils';
import { dfxLogoBall1, dfxLogoBall2, dfxLogoText } from './logos/dfx-logo';
import { realunitLogoFullBase64 } from './logos/realunit-logo-full';

export interface GiroCodeData {
  name: string;
  street?: string;
  number?: string;
  zip?: string;
  city?: string;
  country?: string;
  iban: string;
  bic?: string;
  currency?: string;
  amount?: number;
  reference?: string;
}

export enum PdfBrand {
  DFX = 'DFX',
  REALUNIT = 'REALUNIT',
}

export enum LogoSize {
  SMALL = 'SMALL',
  LARGE = 'LARGE',
}

export interface BalanceEntry {
  asset: Asset;
  balance: number;
  price: number | undefined;
  value: number | undefined;
}

// One REALU transaction on the RealUnit balance report (tax voucher): display-ready row built by
// SwissQRService.buildBalanceReportTransactions so the trade classification (buy/sell/transfer +
// settlement) lives in exactly one place.
export interface BalanceReportTransaction {
  date: Date;
  type: 'buy' | 'sell' | 'transfer';
  // i18n key for the "Zahlungsweg" column; absent for a plain transfer (no payment claim)
  paymentMethodKey?: string;
  quantity: number;
  price: number;
  value: number;
}

export class PdfUtil {
  static drawLogo(
    pdf: InstanceType<typeof PDFDocument>,
    brand: PdfBrand = PdfBrand.DFX,
    size: LogoSize = LogoSize.SMALL,
  ): void {
    // RealUnit uses its full company logo (icon + wordmark) top-right at a fixed size on every receipt
    if (brand === PdfBrand.REALUNIT) {
      this.drawRealUnitFullLogo(pdf);
      return;
    }

    const { x, y, scale } = this.getLogoConfig(size);

    pdf.save();
    pdf.translate(x, y);
    pdf.scale(scale);
    this.drawDfxLogoPath(pdf);
    pdf.restore();
  }

  private static getLogoConfig(size: LogoSize): { x: number; y: number; scale: number } {
    if (size === LogoSize.LARGE) {
      return { x: mm2pt(20), y: mm2pt(14), scale: 0.15 };
    }
    return { x: 50, y: 30, scale: 0.12 };
  }

  // Full RealUnit logo (raster PNG) placed top-right, right-aligned to the 190 mm content edge
  private static drawRealUnitFullLogo(pdf: InstanceType<typeof PDFDocument>): void {
    const logoWidth = 45; // mm
    const rightEdge = 190; // mm — receipt content edge (20 mm margin + 170 mm width)
    const top = 14; // mm
    const logo = Buffer.from(realunitLogoFullBase64, 'base64');
    pdf.image(logo, mm2pt(rightEdge - logoWidth), mm2pt(top), { width: mm2pt(logoWidth) });
  }

  private static drawDfxLogoPath(pdf: InstanceType<typeof PDFDocument>): void {
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
  }

  static drawTable(
    pdf: InstanceType<typeof PDFDocument>,
    balances: BalanceEntry[],
    currency: PriceCurrency,
    language: PdfLanguage,
    i18n: I18nService,
    brand: PdfBrand = PdfBrand.DFX,
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
    pdf.text(this.translate('balance.table.headers.asset', language, i18n), marginX, y, { width: col1Width - 10 });
    pdf.text(this.translate('balance.table.headers.balance', language, i18n), marginX + col1Width, y, {
      width: col2Width - 10,
    });
    pdf.text(
      this.translate('balance.table.headers.price', language, i18n, { currency }),
      marginX + col1Width + col2Width,
      y,
      {
        width: col3Width - 10,
      },
    );
    pdf.text(
      this.translate('balance.table.headers.value', language, i18n, { currency }),
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
      pdf.text(this.translate('balance.table.no_assets', language, i18n), marginX, y);
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

        // RealUnit: the REALU position carries the full security identification (name + ISIN), the
        // same text as on the transaction receipts, so the balance report works as a tax document.
        if (brand === PdfBrand.REALUNIT && entry.asset.name === 'REALU') {
          const securityDescription = this.translate('invoice.realunit_receipt.buy_description', language, i18n, {
            assetBlockchain: entry.asset.blockchain,
          });
          pdf.fontSize(8).fillColor('#707070');
          pdf.text(securityDescription, marginX, y + 14, { width: tableWidth - 10 });
          y += pdf.heightOfString(securityDescription, { width: tableWidth - 10 }) + 6;
          pdf.fontSize(10).font('Helvetica').fillColor('#333333');
        }

        y += 25;
      }
    }

    pdf
      .moveTo(marginX, y)
      .lineTo(width - marginX, y)
      .stroke('#CCCCCC');
    pdf.y = y + 10;
  }

  // REALU transactions of the covered tax period, appended to the RealUnit balance report on its own
  // page so the report works as a standalone tax voucher (holdings + movements). Layout mirrors the
  // transaction-history receipt: chronological rows with type + payment method, then per-type totals.
  static drawRealuTransactionsSection(
    pdf: InstanceType<typeof PDFDocument>,
    transactions: BalanceReportTransaction[],
    currency: PriceCurrency,
    language: PdfLanguage,
    i18n: I18nService,
  ): void {
    if (transactions.length === 0) return;

    const marginX = 50;
    const { width } = pdf.page;
    const tableWidth = width - marginX * 2;

    const colDate = 65;
    const colType = 70;
    const colPayment = 115;
    const colQty = 60;
    const colPrice = 90;
    const colValue = tableWidth - colDate - colType - colPayment - colQty - colPrice;

    const sorted = [...transactions].sort((a, b) => a.date.getTime() - b.date.getTime());
    const formatChDate = (d: Date): string =>
      new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric' })
        .format(d)
        .replace(/\//g, '.');

    pdf.addPage();

    pdf.fontSize(16).font('Helvetica-Bold').fillColor('#072440');
    pdf.text(this.translate('invoice.realunit_receipt.history_title', language, i18n), marginX, 50);

    // Covered period = first to last transaction of the report's tax period
    pdf.fontSize(11).font('Helvetica').fillColor('#707070');
    const period = `${formatChDate(sorted[0].date)} – ${formatChDate(sorted[sorted.length - 1].date)}`;
    pdf.text(`${this.translate('invoice.realunit_receipt.period_label', language, i18n)}: ${period}`, marginX, 78);

    let y = 105;
    pdf.fontSize(11).font('Helvetica-Bold').fillColor('#072440');
    pdf.text(this.translate('invoice.realunit_receipt.date_label', language, i18n), marginX, y, { width: colDate });
    pdf.text(this.translate('invoice.realunit_receipt.type_column', language, i18n), marginX + colDate, y, {
      width: colType,
    });
    pdf.text(
      this.translate('invoice.realunit_receipt.payment_method_label', language, i18n),
      marginX + colDate + colType,
      y,
      { width: colPayment },
    );
    pdf.text(
      this.translate('invoice.table.headers.quantity', language, i18n),
      marginX + colDate + colType + colPayment,
      y,
      { width: colQty },
    );
    pdf.text(
      this.translate('invoice.realunit_receipt.unit_price_label', language, i18n),
      marginX + colDate + colType + colPayment + colQty,
      y,
      { width: colPrice },
    );
    pdf.text(
      this.translate('invoice.realunit_receipt.amount_label', language, i18n),
      marginX + colDate + colType + colPayment + colQty + colPrice,
      y,
      { width: colValue, align: 'right' },
    );

    y += 20;
    pdf
      .moveTo(marginX, y)
      .lineTo(width - marginX, y)
      .stroke('#CCCCCC');
    y += 10;

    pdf.fontSize(10).font('Helvetica').fillColor('#333333');
    for (const tx of sorted) {
      if (y > pdf.page.height - 100) {
        pdf.addPage();
        y = 50;
      }

      pdf.text(formatChDate(tx.date), marginX, y, { width: colDate });
      pdf.text(this.translate(`invoice.realunit_receipt.type_${tx.type}`, language, i18n), marginX + colDate, y, {
        width: colType,
      });
      pdf.text(
        tx.paymentMethodKey ? this.translate(tx.paymentMethodKey, language, i18n) : '',
        marginX + colDate + colType,
        y,
        { width: colPayment },
      );
      pdf.text(this.formatNumber(tx.quantity, 8), marginX + colDate + colType + colPayment, y, { width: colQty });
      pdf.text(this.formatCurrency(tx.price, currency), marginX + colDate + colType + colPayment + colQty, y, {
        width: colPrice,
      });
      pdf.text(
        this.formatCurrency(tx.value, currency),
        marginX + colDate + colType + colPayment + colQty + colPrice,
        y,
        { width: colValue, align: 'right' },
      );

      y += 20;
    }

    pdf
      .moveTo(marginX, y)
      .lineTo(width - marginX, y)
      .stroke('#CCCCCC');
    y += 10;

    // Per-type totals — a mixed grand total across buys, sells and transfers would be meaningless
    for (const type of ['buy', 'sell', 'transfer'] as const) {
      const items = sorted.filter((t) => t.type === type);
      if (items.length === 0) continue;
      const total = items.reduce((sum, t) => sum + t.value, 0);

      if (y > pdf.page.height - 100) {
        pdf.addPage();
        y = 50;
      }

      pdf.fontSize(10).font('Helvetica-Bold').fillColor('#072440');
      pdf.text(this.translate(`invoice.realunit_receipt.total_${type}_label`, language, i18n), marginX, y, {
        width: tableWidth - colValue - 10,
      });
      pdf.text(this.formatCurrency(total, currency), width - marginX - colValue, y, {
        width: colValue,
        align: 'right',
      });
      y += 18;
    }
  }

  static drawFooter(
    pdf: InstanceType<typeof PDFDocument>,
    totalValue: number,
    hasIncompleteData: boolean,
    currency: PriceCurrency,
    language: PdfLanguage,
    i18n: I18nService,
  ): void {
    const marginX = 50;
    const { width } = pdf.page;

    let y = pdf.y + 10;

    pdf.fontSize(12).font('Helvetica-Bold').fillColor('#072440');
    pdf.text(`${this.translate('balance.total_value', language, i18n)}:`, marginX, y);
    pdf.text(this.formatCurrency(totalValue, currency), width - marginX - 150, y, { width: 150, align: 'right' });

    if (hasIncompleteData) {
      y += 25;
      pdf.fontSize(9).font('Helvetica').fillColor('#707070');
      pdf.text(this.translate('balance.incomplete_data', language, i18n), marginX, y);
      y += 15;
    } else {
      y += 25;
    }

    y += 20;
    pdf.fontSize(8).font('Helvetica').fillColor('#999999');
    pdf.text(`${this.translate('balance.generated_by', language, i18n)} - ${new Date().toISOString()}`, marginX, y);
  }

  static translate(key: string, language: PdfLanguage, i18n: I18nService, args?: any): string {
    return i18n.translate(key, { lang: language.toLowerCase(), args });
  }

  static formatNumber(value: number, decimals: number): string {
    return value.toLocaleString('de-CH', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  }

  static formatCurrency(value: number | undefined, currency: PriceCurrency): string {
    if (value == null) return 'n/a';
    const symbol = currency === PriceCurrency.CHF ? 'CHF' : currency === PriceCurrency.EUR ? '€' : '$';
    return `${symbol} ${value.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  static sortBalancesByValue(balances: BalanceEntry[]): BalanceEntry[] {
    return balances.sort((a, b) => {
      if (a.value == null && b.value == null) return 0;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      return b.value - a.value;
    });
  }

  static generateGiroCode(data: GiroCodeData): string {
    const streetNumber = [data.street, data.number].filter(Boolean).join(' ');
    const zipCity = [data.zip, data.city].filter(Boolean).join(' ');
    const addressLine = [data.name, streetNumber, zipCity, data.country].filter(Boolean).join(', ');
    const amountStr = data.amount && data.currency ? `${data.currency}${data.amount}` : '';

    return `
${Config.giroCode.service}
${Config.giroCode.version}
${Config.giroCode.encoding}
${Config.giroCode.transfer}
${data.bic ?? ''}
${addressLine}
${data.iban}
${amountStr}
${Config.giroCode.char}
${Config.giroCode.ref}
${data.reference ?? ''}
`.trim();
  }
}
