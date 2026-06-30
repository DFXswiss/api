import { BadRequestException, Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LogoSize, PdfBrand, PdfUtil } from 'src/shared/utils/pdf.util';
import { AmountType, Util } from 'src/shared/utils/util';
import { BankInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy-payment-info.dto';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { HistoryEventDto } from 'src/subdomains/supporting/realunit/dto/realunit.dto';
import { PDFColumn, PDFRow, SwissQRBill, Table } from 'swissqrbill/pdf';
import { SwissQRCode } from 'swissqrbill/svg';
import { Creditor, Debtor, Data as QrBillData } from 'swissqrbill/types';
import { mm2pt } from 'swissqrbill/utils';
import { TxStatementDetails, TxStatementType } from '../dto/transaction-helper/tx-statement-details.dto';
import { TransactionType } from '../dto/transaction.dto';
import { TransactionRequest } from '../entities/transaction-request.entity';
import { Transaction } from '../entities/transaction.entity';

enum SupportedInvoiceLanguage {
  DE = 'DE',
  EN = 'EN',
  FR = 'FR',
  IT = 'IT',
}

enum SupportedSwissQRBillCurrency {
  CHF = 'CHF',
  EUR = 'EUR',
}

interface SwissQRBillTableData {
  title: string;
  quantity: number | string;
  description: any;
  fiatAmount: number;
  date: Date;
  unitPrice?: number;
  txHash?: string;
  walletAddress?: string;
  buyerName?: string;
}

@Injectable()
export class SwissQRService {
  constructor(
    private readonly assetService: AssetService,
    private readonly i18n: I18nService,
  ) {}

  createQrCode(amount: number, currency: 'CHF', reference: string, bankInfo: BankInfoDto, userData?: UserData): string {
    const data = this.generateQrData(amount, currency, bankInfo, reference, userData);
    return new SwissQRCode(data).toString();
  }

  async createInvoiceFromRequest(
    amount: number,
    currency: string,
    reference: string,
    bankInfo: BankInfoDto,
    request: TransactionRequest,
  ): Promise<string> {
    currency = Config.invoice.currencies.includes(currency) ? currency : Config.invoice.defaultCurrency;
    if (!this.isSupportedInvoiceCurrency(currency)) {
      throw new Error('PDF invoice is only available for CHF and EUR transactions');
    }

    const data = this.generateQrData(amount, currency, bankInfo, reference, request.userData);

    const userLanguage = request.userData.language.symbol.toUpperCase();
    const language = this.isSupportedInvoiceLanguage(userLanguage) ? userLanguage : 'EN';
    const asset = await this.assetService.getAssetById(request.targetId);
    const tableData: SwissQRBillTableData = {
      title: this.translate('invoice.title', language, { invoiceId: request.id }),
      quantity: request.estimatedAmount,
      description: {
        assetDescription: asset.description ?? asset.name,
        assetName: asset.name,
        assetBlockchain: asset.blockchain,
      },
      fiatAmount: amount,
      date: request.created,
    };

    return this.generatePdfInvoice(
      tableData,
      language,
      data,
      bankInfo,
      TransactionType.BUY,
      PdfBrand.DFX,
      request.userData.completeName,
    );
  }

  async createTxStatement(
    { statementType, transactionType, transaction, currency, bankInfo, reference, request }: TxStatementDetails,
    brand: PdfBrand = PdfBrand.DFX,
  ): Promise<string> {
    const debtor = this.getDebtor(transaction.userData);
    const validatedCurrency = this.validateCurrency(currency);
    const language = this.getLanguage(transaction.userData);
    const tableData = await this.getTableData(statementType, transactionType, transaction, validatedCurrency, request);

    const amount = request?.amount ?? transaction.buyCrypto?.inputAmount;
    const billData: QrBillData = {
      creditor: (bankInfo && this.getCreditor(bankInfo)) || this.getDefaultCreditor(brand),
      debtor,
      currency: validatedCurrency,
      amount: bankInfo && amount,
      message: reference,
    };

    return this.generatePdfInvoice(
      tableData,
      language,
      billData,
      bankInfo,
      transactionType,
      brand,
      transaction.userData.completeName,
    );
  }

  async createTxFromBlockchainReceipt(
    historyEvent: HistoryEventDto,
    userData: UserData,
    asset: Asset,
    fiatPrice: number,
    currency: 'CHF' | 'EUR',
    isIncoming: boolean,
    brand: PdfBrand = PdfBrand.REALUNIT,
    languageOverride?: string,
    walletAddress?: string,
  ): Promise<string> {
    const debtor = this.getDebtor(userData);
    const language = languageOverride ?? this.getLanguage(userData);
    const tokenAmount = Number(historyEvent.transfer.value);
    const fiatAmount = Util.roundReadable(tokenAmount * fiatPrice, AmountType.FIAT);

    const tableData: SwissQRBillTableData = {
      title: this.translate('invoice.receipt_title', language.toLowerCase(), {
        invoiceId: this.shortenTxHash(historyEvent.txHash),
      }),
      quantity: tokenAmount,
      description: {
        assetDescription: asset.description ?? asset.name,
        assetName: asset.name,
        assetBlockchain: asset.blockchain,
      },
      fiatAmount,
      date: historyEvent.timestamp,
      unitPrice: fiatPrice,
      txHash: historyEvent.txHash,
      walletAddress,
      buyerName: userData.completeName,
    };

    const billData: QrBillData = {
      creditor: this.getDefaultCreditor(brand),
      debtor,
      currency,
    };

    const transactionType = isIncoming ? TransactionType.BUY : TransactionType.SELL;
    return this.generatePdfInvoice(
      tableData,
      language,
      billData,
      undefined,
      transactionType,
      brand,
      userData.completeName,
      true,
    );
  }

  async createTxFromBlockchainMultiReceipt(
    receipts: Array<{
      historyEvent: HistoryEventDto;
      fiatPrice: number;
      isIncoming: boolean;
    }>,
    userData: UserData,
    asset: Asset,
    currency: 'CHF' | 'EUR',
    brand: PdfBrand = PdfBrand.REALUNIT,
    languageOverride?: string,
    walletAddress?: string,
  ): Promise<string> {
    if (receipts.length === 0) throw new Error('At least one transaction is required');

    const debtor = this.getDebtor(userData);
    const language = languageOverride ?? this.getLanguage(userData);

    const tableDataWithType: { data: SwissQRBillTableData; type: TransactionType }[] = [];

    for (const { historyEvent, fiatPrice, isIncoming } of receipts) {
      const tokenAmount = Number(historyEvent.transfer.value);
      const fiatAmount = Util.roundReadable(tokenAmount * fiatPrice, AmountType.FIAT);

      const tableData: SwissQRBillTableData = {
        title: this.translate('invoice.receipt_title', language.toLowerCase(), {
          invoiceId: this.shortenTxHash(historyEvent.txHash),
        }),
        quantity: tokenAmount,
        description: {
          assetDescription: asset.description ?? asset.name,
          assetName: asset.name,
          assetBlockchain: asset.blockchain,
        },
        fiatAmount,
        date: historyEvent.timestamp,
        unitPrice: fiatPrice,
        txHash: historyEvent.txHash,
      };

      const transactionType = isIncoming ? TransactionType.BUY : TransactionType.SELL;
      tableDataWithType.push({ data: tableData, type: transactionType });
    }

    const billData: QrBillData = {
      creditor: this.getDefaultCreditor(brand),
      debtor,
      currency,
    };

    return this.generateMultiPdfInvoice(
      tableDataWithType,
      language,
      billData,
      brand,
      true,
      walletAddress,
      userData.completeName,
    );
  }

  private shortenTxHash(txHash: string): string {
    if (txHash.length <= 16) return txHash;
    return `${txHash.slice(0, 8)}...${txHash.slice(-8)}`;
  }

  // Format an execution timestamp in the Swiss time zone (DST-safe) for RealUnit receipts
  private formatChDateParts(date: Date): { day: number; month: number; year: number; hour: string; minute: string } {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Zurich',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    return {
      day: Number(get('day')),
      month: Number(get('month')),
      year: Number(get('year')),
      hour: get('hour'),
      minute: get('minute'),
    };
  }

  private formatChDateTime(date: Date): string {
    const p = this.formatChDateParts(date);
    return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
  }

  private async generatePdfInvoice(
    tableData: SwissQRBillTableData,
    language: string,
    billData: QrBillData,
    bankInfo: BankInfoDto | undefined,
    transactionType: TransactionType,
    brand: PdfBrand = PdfBrand.DFX,
    debtorName?: string,
    skipTermsAndConditions = false,
  ): Promise<string> {
    const { pdf, promise } = this.createPdfWithBase64Promise();
    const isRealUnit = brand === PdfBrand.REALUNIT;
    const lang = language.toLowerCase();

    PdfUtil.drawLogo(pdf, brand, LogoSize.LARGE);
    this.drawSenderAddress(pdf, brand);
    this.drawDebtorAddress(pdf, billData.debtor, debtorName);
    this.drawTitle(pdf, tableData.title);

    // Date (+ time for RealUnit, formatted in Swiss time zone)
    const d = tableData.date;
    pdf.fontSize(11);
    pdf.font('Helvetica');
    if (isRealUnit) {
      const creditorCity = Config.blockchain.realunit.address.city;
      pdf.text(`${creditorCity}, ${this.formatChDateTime(d)}`, {
        align: 'right',
        width: mm2pt(170),
      });
    } else {
      pdf.text(`Zug ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`, {
        align: 'right',
        width: mm2pt(170),
      });
    }

    // Description key: use RealUnit-specific key when applicable
    const descriptionKey = isRealUnit
      ? `invoice.realunit_receipt.${transactionType.toLowerCase()}_description`
      : `invoice.table.position_row.${transactionType.toLowerCase()}_description`;

    // Table columns vary: RealUnit adds a unit price column
    const hasUnitPrice = isRealUnit && tableData.unitPrice != null;
    const headerColumns: PDFColumn[] = [
      {
        text: this.translate('invoice.table.headers.quantity', lang) + (bankInfo ? ' *' : ''),
        width: hasUnitPrice ? mm2pt(25) : mm2pt(40),
      },
      {
        text: this.translate('invoice.table.headers.description', lang),
      },
    ];
    if (hasUnitPrice) {
      headerColumns.push({
        text: this.translate('invoice.realunit_receipt.unit_price_label', lang),
        width: mm2pt(30),
      });
    }
    headerColumns.push({
      text: this.translate('invoice.table.headers.total', lang),
      width: mm2pt(30),
    });

    const dataColumns: PDFColumn[] = [
      {
        text: `${tableData.quantity}`,
        width: hasUnitPrice ? mm2pt(25) : mm2pt(40),
      },
      {
        text: this.translate(descriptionKey, lang, tableData.description),
      },
    ];
    if (hasUnitPrice) {
      dataColumns.push({
        text: `${billData.currency} ${tableData.unitPrice.toFixed(2)}`,
        width: mm2pt(30),
      });
    }
    dataColumns.push({
      text: `${billData.currency} ${tableData.fiatAmount.toFixed(2)}`,
      width: mm2pt(30),
    });

    const emptyCol = (w: number): PDFColumn => ({ text: '', width: mm2pt(w) });
    const qtyEmptyWidth = hasUnitPrice ? 25 : 40;

    // Table rows
    const rows: PDFRow[] = [
      {
        backgroundColor: '#4A4D51',
        columns: headerColumns,
        fontName: 'Helvetica-Bold',
        height: 20,
        padding: 5,
        textColor: '#fff',
        verticalAlign: 'center',
      },
      {
        columns: dataColumns,
        padding: 5,
      },
      {
        columns: [
          emptyCol(qtyEmptyWidth),
          {
            fontName: 'Helvetica-Bold',
            text: this.translate('invoice.table.total_row.total_label', lang),
          },
          ...(hasUnitPrice ? [emptyCol(30)] : []),
          {
            fontName: 'Helvetica-Bold',
            text: `${billData.currency} ${tableData.fiatAmount.toFixed(2)}`,
            width: mm2pt(30),
          },
        ],
        height: 40,
        padding: 5,
      },
    ];

    // Fees row for RealUnit
    if (isRealUnit) {
      rows.push({
        columns: [
          emptyCol(qtyEmptyWidth),
          { text: this.translate('invoice.realunit_receipt.fees_label', lang) },
          ...(hasUnitPrice ? [emptyCol(30)] : []),
          { text: this.translate('invoice.realunit_receipt.fees_free', lang), width: mm2pt(30) },
        ],
        padding: 5,
      });
    }

    // VAT rows
    rows.push(
      {
        columns: [
          emptyCol(qtyEmptyWidth),
          { text: this.translate('invoice.table.vat_row.vat_label', lang) },
          ...(hasUnitPrice ? [emptyCol(30)] : []),
          { text: '0%', width: mm2pt(30) },
        ],
        padding: 5,
      },
      {
        columns: [
          emptyCol(qtyEmptyWidth),
          { text: this.translate('invoice.table.vat_row.vat_amount_label', lang) },
          ...(hasUnitPrice ? [emptyCol(30)] : []),
          { text: `${billData.currency} 0.00`, width: mm2pt(30) },
        ],
        padding: 5,
      },
    );

    // Total row
    const totalLabel = isRealUnit
      ? this.translate('invoice.realunit_receipt.receipt_total_label', lang)
      : this.translate(
          transactionType === TransactionType.REFERRAL
            ? 'invoice.table.credit_total_row.credit_total_label'
            : 'invoice.table.invoice_total_row.invoice_total_label',
          lang,
        );
    rows.push({
      columns: [
        emptyCol(qtyEmptyWidth),
        { fontName: 'Helvetica-Bold', text: totalLabel },
        ...(hasUnitPrice ? [emptyCol(30)] : []),
        {
          fontName: 'Helvetica-Bold',
          text: `${billData.currency} ${tableData.fiatAmount.toFixed(2)}`,
          width: mm2pt(30),
        },
      ],
      height: 40,
      padding: 5,
    });

    if (bankInfo) {
      rows.push({
        columns: [
          {
            text: this.translate('invoice.info', lang),
            textOptions: { oblique: true, lineGap: 2 },
            fontSize: 10,
            width: mm2pt(170),
          },
        ],
      });
    }

    if (!skipTermsAndConditions) {
      rows.push({ columns: [this.getTermsAndConditions(lang)] });
    }

    const table = new Table({ rows, width: mm2pt(170) });
    table.attachTo(pdf);

    // RealUnit details section (buyer, wallet, txHash, payment method)
    if (isRealUnit && (tableData.txHash || tableData.walletAddress || tableData.buyerName)) {
      this.drawReceiptDetails(pdf, tableData, lang);
    }

    // QR-Bill (Swiss/LI IBAN) or GiroCode (other IBANs)
    const isDomesticTransfer = bankInfo && Config.isDomesticIban(bankInfo.iban);
    if (isDomesticTransfer) {
      const qrBill = new SwissQRBill(billData, { language: language as SupportedInvoiceLanguage });
      qrBill.attachTo(pdf);
    } else if (bankInfo) {
      const qrSize = 25; // mm
      const qrX = mm2pt(20);
      const textX = mm2pt(20 + qrSize + 5);
      const startY = pdf.y + 15;

      // GiroCode QR
      const giroCode = PdfUtil.generateGiroCode({
        ...bankInfo,
        currency: billData.currency,
        amount: billData.amount,
        reference: billData.message,
      });
      const qrDataUrl = await QRCode.toDataURL(giroCode, { width: 150, margin: 1 });
      const qrImage = qrDataUrl.replace(/^data:image\/png;base64,/, '');

      pdf.image(Buffer.from(qrImage, 'base64'), qrX, startY, { width: mm2pt(qrSize) });

      // Payment info text
      const recipientAddress = [bankInfo.street, bankInfo.number].filter(Boolean).join(' ');
      const recipientCity = [bankInfo.zip, bankInfo.city].filter(Boolean).join(' ');
      const recipientFull = [bankInfo.name, recipientAddress, recipientCity, bankInfo.country]
        .filter(Boolean)
        .join(', ');

      pdf.font('Helvetica-Bold').fontSize(11);
      pdf.text(this.translate('invoice.payment_info', language), textX, startY);

      const paymentInfoData = [
        { label: this.translate('invoice.payment_info_recipient', language), value: recipientFull },
        { label: this.translate('invoice.payment_info_iban', language), value: bankInfo.iban },
        { label: this.translate('invoice.payment_info_bic', language), value: bankInfo.bic ?? '' },
        { label: this.translate('invoice.payment_info_reference', language), value: billData.message ?? '' },
      ];

      pdf.fontSize(10);
      let currentY = startY + 18;
      for (const { label, value } of paymentInfoData) {
        pdf.font('Helvetica-Bold').text(label, textX, currentY, { continued: true });
        pdf.font('Helvetica').text(`  ${value}`);
        currentY += 14;
      }
    }

    pdf.end();

    return promise;
  }

  private drawReceiptDetails(
    pdf: typeof PDFDocument.prototype,
    receipt: { buyerName?: string; walletAddress?: string; txHash?: string },
    lang: string,
  ): void {
    const labelX = mm2pt(20);

    const details: { label: string; value: string }[] = [];

    if (receipt.buyerName) {
      details.push({
        label: this.translate('invoice.realunit_receipt.buyer_label', lang),
        value: receipt.buyerName,
      });
    }

    if (receipt.walletAddress) {
      details.push({
        label: this.translate('invoice.realunit_receipt.wallet_label', lang),
        value: receipt.walletAddress,
      });
    }

    if (receipt.txHash) {
      details.push({
        label: this.translate('invoice.realunit_receipt.tx_hash_label', lang),
        value: receipt.txHash,
      });
    }

    // Start a new page if title + all detail rows would not fit on the current page.
    // Long values (wallet, tx hash) wrap to a second line, so reserve up to two lines per
    // detail plus a safety margin — overestimate on purpose so nothing gets cut off.
    const estimatedHeight = 15 + 22 + details.length * 26 + 10;
    if (pdf.y + estimatedHeight > pdf.page.height - pdf.page.margins.bottom) pdf.addPage();

    pdf.font('Helvetica-Bold').fontSize(11);
    pdf.text(this.translate('invoice.realunit_receipt.details_title', lang), labelX, pdf.y + 15);

    pdf.fontSize(10);
    let currentY = pdf.y + 8;
    for (const { label, value } of details) {
      // width must sit on the first (label) segment of the continued chain to wrap long values (wallet/tx hash)
      pdf.font('Helvetica-Bold').text(`${label}:`, labelX, currentY, { continued: true, width: mm2pt(150) });
      pdf.font('Helvetica').text(`  ${value}`);
      currentY = pdf.y + 4;
    }
  }

  private generateMultiPdfInvoice(
    tableDataWithType: { data: SwissQRBillTableData; type: TransactionType }[],
    language: string,
    billData: QrBillData,
    brand: PdfBrand = PdfBrand.DFX,
    skipTermsAndConditions = false,
    walletAddress?: string,
    buyerName?: string,
  ): Promise<string> {
    const { pdf, promise } = this.createPdfWithBase64Promise();
    const isRealUnit = brand === PdfBrand.REALUNIT;
    const lang = language.toLowerCase();
    const hasUnitPrice = isRealUnit && tableDataWithType.some((t) => t.data.unitPrice != null);

    PdfUtil.drawLogo(pdf, brand, LogoSize.LARGE);
    this.drawSenderAddress(pdf, brand);
    this.drawDebtorAddress(pdf, billData.debtor);
    this.drawTitle(pdf, this.translate('invoice.multi_receipt_title', lang));

    const buyTransactions = tableDataWithType.filter((t) => t.type === TransactionType.BUY);
    const sellTransactions = tableDataWithType.filter((t) => t.type === TransactionType.SELL);
    const buyTotal = buyTransactions.reduce((sum, t) => sum + t.data.fiatAmount, 0);
    const sellTotal = sellTransactions.reduce((sum, t) => sum + t.data.fiatAmount, 0);

    const rows: PDFRow[] = [];
    const qtyWidth = hasUnitPrice ? 20 : 30;
    const emptyCol = (w: number): PDFColumn => ({ text: '', width: mm2pt(w) });

    const buildSectionHeader = (sectionKey: string): PDFRow => ({
      columns: [
        {
          text: this.translate(`invoice.section.${sectionKey}`, lang),
          fontName: 'Helvetica-Bold',
          fontSize: 12,
        },
      ],
      height: 30,
      padding: [15, 5, 5, 5],
    });

    const buildTableHeader = (): PDFRow => {
      const cols: PDFColumn[] = [
        { text: this.translate('invoice.table.headers.quantity', lang), width: mm2pt(qtyWidth) },
        { text: this.translate('invoice.table.headers.description', lang) },
      ];
      if (hasUnitPrice) {
        cols.push({ text: this.translate('invoice.realunit_receipt.unit_price_label', lang), width: mm2pt(25) });
      }
      cols.push(
        { text: this.translate('invoice.table.headers.date', lang), width: mm2pt(25) },
        { text: this.translate('invoice.table.headers.total', lang), width: mm2pt(30) },
      );
      return {
        backgroundColor: '#4A4D51',
        columns: cols,
        fontName: 'Helvetica-Bold',
        height: 20,
        padding: 5,
        textColor: '#fff',
        verticalAlign: 'center',
      };
    };

    const buildDataRow = (tableData: SwissQRBillTableData, txType: TransactionType): PDFRow => {
      const txDate = tableData.date;
      const formattedDate = isRealUnit
        ? this.formatChDateTime(txDate)
        : `${txDate.getDate()}.${txDate.getMonth() + 1}.${txDate.getFullYear()}`;

      const descKey = isRealUnit
        ? `invoice.realunit_receipt.${txType.toLowerCase()}_description`
        : `invoice.table.position_row.${txType.toLowerCase()}_description`;

      const cols: PDFColumn[] = [
        { text: `${tableData.quantity}`, width: mm2pt(qtyWidth) },
        { text: this.translate(descKey, lang, tableData.description) },
      ];
      if (hasUnitPrice) {
        cols.push({
          text: tableData.unitPrice != null ? `${billData.currency} ${tableData.unitPrice.toFixed(2)}` : '',
          width: mm2pt(25),
        });
      }
      cols.push(
        { text: formattedDate, width: mm2pt(25) },
        { text: `${billData.currency} ${tableData.fiatAmount.toFixed(2)}`, width: mm2pt(30) },
      );
      return { columns: cols, padding: 5 };
    };

    const buildSubtotalRow = (total: number): PDFRow => {
      const cols: PDFColumn[] = [
        emptyCol(qtyWidth),
        { text: this.translate('invoice.table.total_row.total_label', lang), fontName: 'Helvetica-Bold' },
      ];
      if (hasUnitPrice) cols.push(emptyCol(25));
      cols.push(emptyCol(25), {
        text: `${billData.currency} ${total.toFixed(2)}`,
        width: mm2pt(30),
        fontName: 'Helvetica-Bold',
      });
      return { columns: cols, height: 25, padding: 5 };
    };

    // Full on-chain tx hash per position (verifiable reference), rendered as a slim full-width row
    const buildTxHashRow = (txHash: string): PDFRow => ({
      columns: [
        {
          text: `${this.translate('invoice.realunit_receipt.tx_hash_label', lang)}: ${txHash}`,
          fontSize: 8,
          width: mm2pt(170),
        },
      ],
      padding: [0, 5, 5, 5],
    });

    const buildFeesRow = (): PDFRow => {
      const cols: PDFColumn[] = [
        emptyCol(qtyWidth),
        { text: this.translate('invoice.realunit_receipt.fees_label', lang), fontName: 'Helvetica-Bold' },
      ];
      if (hasUnitPrice) cols.push(emptyCol(25));
      cols.push(emptyCol(25), {
        text: this.translate('invoice.realunit_receipt.fees_free', lang),
        width: mm2pt(30),
        fontName: 'Helvetica-Bold',
      });
      return { columns: cols, padding: 5 };
    };

    const pushSection = (
      sectionKey: string,
      txs: { data: SwissQRBillTableData; type: TransactionType }[],
      total: number,
    ): void => {
      rows.push(buildSectionHeader(sectionKey));
      rows.push(buildTableHeader());
      for (const { data, type } of txs) {
        rows.push(buildDataRow(data, type));
        if (isRealUnit && data.txHash) rows.push(buildTxHashRow(data.txHash));
      }
      rows.push(buildSubtotalRow(total));
      if (isRealUnit) rows.push(buildFeesRow());
    };

    if (buyTransactions.length > 0) pushSection('buy', buyTransactions, buyTotal);
    if (sellTransactions.length > 0) pushSection('sell', sellTransactions, sellTotal);

    if (!skipTermsAndConditions) {
      rows.push({ columns: [this.getTermsAndConditions(lang)] });
    }

    const table = new Table({ rows, width: mm2pt(170) });
    table.attachTo(pdf);

    // RealUnit details section
    if (isRealUnit && (walletAddress || buyerName)) {
      this.drawReceiptDetails(pdf, { buyerName, walletAddress }, lang);
    }

    pdf.end();

    return promise;
  }

  private createPdfWithBase64Promise(): { pdf: typeof PDFDocument.prototype; promise: Promise<string> } {
    const pdf = new PDFDocument({ size: 'A4' });
    const base64: Buffer[] = [];

    const promise = new Promise<string>((resolve, reject) => {
      pdf.on('data', (data: Buffer) => base64.push(data));
      pdf.on('end', () => resolve(Buffer.concat(base64).toString('base64')));
      pdf.on('error', reject);
    });

    return { pdf, promise };
  }

  private drawSenderAddress(pdf: typeof PDFDocument.prototype, brand: PdfBrand): void {
    const sender = this.getDefaultCreditor(brand);
    pdf.fontSize(12);
    pdf.fillColor('black');
    pdf.font('Helvetica');
    pdf.text(
      `${sender.name}\n${sender.address} ${sender.buildingNumber}\n${sender.zip} ${sender.city}`,
      mm2pt(20),
      mm2pt(35),
      { align: 'left', height: mm2pt(50), width: mm2pt(100) },
    );
  }

  private drawDebtorAddress(pdf: typeof PDFDocument.prototype, debtor?: Debtor, fallbackName?: string): void {
    const displayName = debtor?.name ?? fallbackName;
    if (!displayName) return;

    pdf.fontSize(12);
    pdf.font('Helvetica');
    const addressLine = debtor ? [debtor.address, debtor.buildingNumber].filter(Boolean).join(' ') : '';
    const cityLine = debtor ? [debtor.zip, debtor.city].filter(Boolean).join(' ') : '';
    pdf.text([displayName, addressLine, cityLine].filter(Boolean).join('\n'), mm2pt(130), mm2pt(60), {
      align: 'left',
      height: mm2pt(50),
      width: mm2pt(70),
    });
  }

  private drawTitle(pdf: typeof PDFDocument.prototype, title: string): void {
    pdf.fontSize(14);
    pdf.font('Helvetica-Bold');
    pdf.text(title, mm2pt(20), mm2pt(100), { align: 'left', width: mm2pt(170) });
  }

  private getTermsAndConditions(language: string): PDFColumn {
    return {
      text: this.translate('invoice.terms', language),
      textOptions: { lineGap: 2 },
      fontSize: 10,
      width: mm2pt(170),
      padding: [5, 0, 5, 0],
    };
  }

  private validateCurrency(currency: string): SupportedSwissQRBillCurrency {
    currency = Config.invoice.currencies.includes(currency) ? currency : Config.invoice.defaultCurrency;
    if (!this.isSupportedInvoiceCurrency(currency)) {
      throw new Error('PDF invoice is only available for CHF and EUR transactions');
    }
    return currency;
  }

  private getLanguage(userData: UserData): SupportedInvoiceLanguage {
    const userLanguage = userData.language.symbol.toUpperCase();
    return this.isSupportedInvoiceLanguage(userLanguage) ? userLanguage : SupportedInvoiceLanguage.EN;
  }

  private getDefaultCreditor(brand: PdfBrand): Creditor {
    return (brand === PdfBrand.REALUNIT ? this.realunitCreditor() : this.dfxCreditor()) as unknown as Creditor;
  }

  private dfxCreditor(): Creditor {
    const dfxAddress = Config.bank.dfxAddress;
    return {
      name: dfxAddress.name,
      address: dfxAddress.street,
      buildingNumber: dfxAddress.number,
      zip: dfxAddress.zip,
      city: dfxAddress.city,
      country: 'CH',
    } as Creditor;
  }

  private realunitCreditor(): Creditor {
    const { bank, address } = Config.blockchain.realunit;
    return {
      name: bank.recipient,
      address: address.street,
      buildingNumber: address.number,
      zip: address.zip,
      city: address.city,
      country: 'CH',
    } as Creditor;
  }

  private isSupportedInvoiceLanguage(lang: string): lang is SupportedInvoiceLanguage {
    return Object.keys(SupportedInvoiceLanguage).includes(lang);
  }

  private isSupportedInvoiceCurrency(currency: string): currency is SupportedSwissQRBillCurrency {
    return Object.keys(SupportedSwissQRBillCurrency).includes(currency);
  }

  private translate(key: string, lang: string, args?: any): string {
    return this.i18n.translate(key, { lang: lang.toLowerCase(), args });
  }

  private generateQrData(
    amount: number,
    currency: 'CHF' | 'EUR',
    bankInfo: BankInfoDto,
    reference?: string,
    userData?: UserData,
  ): QrBillData {
    return {
      amount,
      currency,
      message: reference,
      creditor: this.getCreditor(bankInfo),
      debtor: this.getDebtor(userData),
    };
  }

  private getStatementTitle(
    statementType: TxStatementType,
    transactionType: TransactionType,
    transaction: Transaction,
    request?: TransactionRequest,
  ): string {
    let titleKey: string;

    if (statementType === TxStatementType.RECEIPT) {
      titleKey = 'invoice.receipt_title';
    } else if (transactionType === TransactionType.REFERRAL) {
      titleKey = 'invoice.credit_title';
    } else {
      titleKey = 'invoice.title';
    }

    const invoiceId = request?.id ?? transaction.id;

    return this.translate(titleKey, transaction.userData.language.symbol.toLowerCase(), {
      invoiceId,
    });
  }

  private getStatementDate(statementType: TxStatementType, transaction: Transaction): Date {
    return statementType === TxStatementType.RECEIPT ? transaction.completionDate : transaction.created;
  }

  private getCreditor(bankInfo: BankInfoDto): Creditor {
    const creditor: Creditor = {
      account: bankInfo.iban,
      address: bankInfo.street,
      city: bankInfo.city,
      country: bankInfo.iban.substring(0, 2).toUpperCase(),
      name: bankInfo.name,
      zip: bankInfo.zip,
    };
    if (bankInfo.number != null) creditor.buildingNumber = bankInfo.number;

    return creditor;
  }

  private getDebtor(userData?: UserData): Debtor | undefined {
    if (!userData?.isInvoiceDataComplete) return undefined;

    const name = userData.completeName;
    const address = userData.address;

    // SwissQRBill requires country to be exactly 2 characters
    // If no valid address, return undefined (debtor is optional in QR bill)
    if (!address?.country?.symbol) return undefined;

    const debtor: Debtor = {
      name,
      address: address.street ?? '',
      city: address.city ?? '',
      country: address.country.symbol,
      zip: address.zip ?? '',
    };
    if (address.houseNumber != null) debtor.buildingNumber = address.houseNumber;

    return debtor;
  }

  private async getTableData(
    statementType: TxStatementType,
    transactionType: TransactionType,
    transaction: Transaction,
    currency: string,
    request?: TransactionRequest,
  ): Promise<SwissQRBillTableData> {
    const titleAndDate = {
      title: this.getStatementTitle(statementType, transactionType, transaction, request),
      date: this.getStatementDate(statementType, transaction),
    };

    switch (transactionType) {
      case TransactionType.BUY: {
        // Handle pending transactions with request data
        if (request) {
          const asset = await this.assetService.getAssetById(request.targetId);
          return {
            quantity: request.estimatedAmount,
            description: {
              assetDescription: asset.description ?? asset.name,
              assetName: asset.name,
              assetBlockchain: asset.blockchain,
            },
            fiatAmount: request.amount,
            ...titleAndDate,
          };
        }

        const outputAsset = transaction.buyCrypto?.outputAsset;
        const fiatAmount = transaction.buyCrypto?.inputAmount;
        const quantity = transaction.buyCrypto?.outputAmount;
        if (!outputAsset || fiatAmount == null) throw new BadRequestException('Missing invoice information');

        return {
          quantity: quantity ?? '—',
          description: {
            assetDescription: outputAsset.description ?? outputAsset.name,
            assetName: outputAsset.name,
            assetBlockchain: outputAsset.blockchain,
          },
          fiatAmount,
          ...titleAndDate,
        };
      }

      case TransactionType.SELL: {
        const inputAsset = transaction.buyFiat?.cryptoInput?.asset;
        const fiatAmount = transaction.buyFiat?.outputAmount;
        const quantity = transaction.buyFiat?.inputAmount;
        if (!inputAsset || fiatAmount == null || quantity == null)
          throw new BadRequestException('Missing invoice information');

        return {
          quantity,
          description: {
            assetDescription: inputAsset.description ?? inputAsset.name,
            assetName: inputAsset.name,
            assetBlockchain: inputAsset.blockchain,
          },
          fiatAmount,
          ...titleAndDate,
        };
      }

      case TransactionType.SWAP: {
        const sourceAsset = transaction.buyCrypto?.cryptoInput?.asset;
        const targetAsset = transaction.buyCrypto?.outputAsset;
        const fiatAmount = currency === 'CHF' ? transaction.buyCrypto?.amountInChf : transaction.buyCrypto?.amountInEur;
        const quantity = transaction.buyCrypto?.inputAmount;
        const targetAmount = transaction.buyCrypto?.outputAmount;
        if (!sourceAsset || !targetAsset || fiatAmount == null || quantity == null || targetAmount == null)
          throw new BadRequestException('Missing invoice information');

        return {
          quantity,
          description: {
            sourceDescription: sourceAsset.description ?? sourceAsset.name,
            sourceName: sourceAsset.name,
            sourceBlockchain: sourceAsset.blockchain,
            targetAmount,
            targetDescription: targetAsset.description ?? targetAsset.name,
            targetName: targetAsset.name,
            targetBlockchain: targetAsset.blockchain,
          },
          fiatAmount,
          ...titleAndDate,
        };
      }

      case TransactionType.REFERRAL: {
        const targetBlockchain = transaction.refReward?.targetBlockchain;
        if (!targetBlockchain) throw new BadRequestException('Missing invoice information');
        const asset = await this.assetService.getNativeAsset(targetBlockchain);
        if (!asset) throw new BadRequestException('Missing invoice information');
        const fiatAmount = currency === 'CHF' ? transaction.refReward?.amountInChf : transaction.refReward?.amountInEur;
        const quantity = transaction.refReward?.outputAmount;
        if (fiatAmount == null || quantity == null) throw new BadRequestException('Missing invoice information');

        return {
          quantity,
          description: {
            assetName: asset.name,
            assetBlockchain: targetBlockchain,
          },
          fiatAmount,
          ...titleAndDate,
        };
      }

      default:
        throw new Error('Unsupported transaction type');
    }
  }
}
