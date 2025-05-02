import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import PDFDocument from 'pdfkit';
import { Config } from 'src/config/config';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { BankInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy-payment-info.dto';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { PDFColumn, PDFRow, SwissQRBill, Table } from 'swissqrbill/pdf';
import { SwissQRCode } from 'swissqrbill/svg';
import { Creditor, Debtor, Data as QrBillData } from 'swissqrbill/types';
import { mm2pt } from 'swissqrbill/utils';
import { TransactionType } from '../dto/transaction.dto';
import { TransactionRequest } from '../entities/transaction-request.entity';
import { Transaction } from '../entities/transaction.entity';

const dfxLogoBall1 =
  'M86.1582 126.274C109.821 126.274 129.004 107.092 129.004 83.4287C129.004 59.7657 109.821 40.583 86.1582 40.583C62.4952 40.583 43.3126 59.7657 43.3126 83.4287C43.3126 107.092 62.4952 126.274 86.1582 126.274Z';

const dfxLogoBall2 =
  'M47.1374 132.146C73.1707 132.146 94.2748 111.042 94.2748 85.009C94.2748 58.9757 73.1707 37.8716 47.1374 37.8716C21.1041 37.8716 0 58.9757 0 85.009C0 111.042 21.1041 132.146 47.1374 132.146Z';

const dfxLogoText =
  'M61.5031 0H124.245C170.646 0 208.267 36.5427 208.267 84.0393C208.267 131.536 169.767 170.018 122.288 170.018H61.5031V135.504H114.046C141.825 135.504 164.541 112.789 164.541 85.009C164.541 57.2293 141.825 34.5136 114.046 34.5136H61.5031V0ZM266.25 31.5686V76.4973H338.294V108.066H266.25V170H226.906V0H355.389V31.5686H266.25ZM495.76 170L454.71 110.975L414.396 170H369.216L432.12 83.5365L372.395 0H417.072L456.183 55.1283L494.557 0H537.061L477.803 82.082L541.191 170H495.778H495.76Z';

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
}

export enum TransactionStatementType {
  INVOICE = 'INVOICE',
  RECEIPT = 'RECEIPT',
}

@Injectable()
export class SwissQRService {
  constructor(private readonly assetService: AssetService, private readonly i18n: I18nService) {}

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
    if (!data.debtor) throw new Error('Debtor is required');

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
      date: new Date(),
    };

    return this.generatePdfInvoice(tableData, language, data, true, TransactionType.BUY);
  }

  async createTxStatement(
    statementType: TransactionStatementType,
    txType: TransactionType,
    transaction: Transaction,
    currency: string,
    bankInfo?: BankInfoDto,
  ): Promise<string> {
    const debtor = this.getDebtor(transaction.userData);
    if (!debtor) throw new Error('Debtor is required');

    currency = Config.invoice.currencies.includes(currency) ? currency : Config.invoice.defaultCurrency;
    if (!this.isSupportedInvoiceCurrency(currency)) {
      throw new Error('PDF invoice is only available for CHF and EUR transactions');
    }

    const userLanguage = transaction.userData.language.symbol.toUpperCase();
    const language = this.isSupportedInvoiceLanguage(userLanguage) ? userLanguage : 'EN';
    const tableData = await this.getTableData(statementType, txType, transaction, currency);

    const billData: QrBillData = {
      creditor: (bankInfo && this.getCreditor(bankInfo)) ?? (this.dfxCreditor() as unknown as Creditor),
      debtor,
      currency,
      amount: bankInfo && transaction.buyCrypto?.inputAmount,
      message: bankInfo && transaction.buyCrypto?.buy.bankUsage,
    };

    return this.generatePdfInvoice(tableData, language, billData, !!bankInfo, txType);
  }

  private generatePdfInvoice(
    tableData: SwissQRBillTableData,
    language: string,
    billData: QrBillData,
    includeQrBill: boolean,
    transactionType: TransactionType,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const pdf = new PDFDocument({ size: 'A4' });

        // Store PDF as base64 string
        const base64 = [];
        pdf.on('data', (data) => {
          base64.push(data);
        });
        pdf.on('end', () => {
          const base64PDF = Buffer.concat(base64).toString('base64');
          resolve(base64PDF);
        });

        // Logo
        pdf.save();
        pdf.translate(mm2pt(20), mm2pt(14));
        pdf.scale(0.15);
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

        // Creditor address
        pdf.fontSize(12);
        pdf.fillColor('black');
        pdf.font('Helvetica');
        pdf.text(
          `${billData.creditor.name}\n${billData.creditor.address} ${billData.creditor.buildingNumber}\n${billData.creditor.zip} ${billData.creditor.city}`,
          mm2pt(20),
          mm2pt(35),
          {
            align: 'left',
            height: mm2pt(50),
            width: mm2pt(100),
          },
        );

        // Debtor address
        pdf.fontSize(12);
        pdf.font('Helvetica');
        pdf.text(
          `${billData.debtor.name}\n${billData.debtor.address} ${billData.debtor.buildingNumber}\n${billData.debtor.zip} ${billData.debtor.city}`,
          mm2pt(130),
          mm2pt(60),
          {
            align: 'left',
            height: mm2pt(50),
            width: mm2pt(70),
          },
        );

        // Title
        pdf.fontSize(14);
        pdf.font('Helvetica-Bold');
        pdf.text(tableData.title, mm2pt(20), mm2pt(100), {
          align: 'left',
          width: mm2pt(170),
        });

        // Date
        pdf.fontSize(11);
        pdf.font('Helvetica');
        pdf.text(`Zug ${tableData.date.getDate()}.${tableData.date.getMonth() + 1}.${tableData.date.getFullYear()}`, {
          align: 'right',
          width: mm2pt(170),
        });

        // Table
        const rows: PDFRow[] = [
          {
            backgroundColor: '#4A4D51',
            columns: [
              {
                text: this.translate('invoice.table.headers.quantity', language) + (includeQrBill ? ' *' : ''),
                width: mm2pt(40),
              },
              {
                text: this.translate('invoice.table.headers.description', language),
              },
              {
                text: this.translate('invoice.table.headers.total', language),
                width: mm2pt(30),
              },
            ],
            fontName: 'Helvetica-Bold',
            height: 20,
            padding: 5,
            textColor: '#fff',
            verticalAlign: 'center',
          },
          {
            columns: [
              {
                text: `${tableData.quantity}`,
                width: mm2pt(40),
              },
              {
                text: this.translate(
                  `invoice.table.position_row.${transactionType.toLowerCase()}_description`,
                  language,
                  tableData.description,
                ),
              },
              {
                text: `${billData.currency} ${tableData.fiatAmount.toFixed(2)}`,
                width: mm2pt(30),
              },
            ],
            padding: 5,
          },
          {
            columns: [
              {
                text: '',
                width: mm2pt(40),
              },
              {
                fontName: 'Helvetica-Bold',
                text: this.translate('invoice.table.total_row.total_label', language),
              },
              {
                fontName: 'Helvetica-Bold',
                text: `${billData.currency} ${tableData.fiatAmount.toFixed(2)}`,
                width: mm2pt(30),
              },
            ],
            height: 40,
            padding: 5,
          },
          {
            columns: [
              {
                text: '',
                width: mm2pt(40),
              },
              {
                text: this.translate('invoice.table.vat_row.vat_label', language),
              },
              {
                text: '0%',
                width: mm2pt(30),
              },
            ],
            padding: 5,
          },
          {
            columns: [
              {
                text: '',
                width: mm2pt(40),
              },
              {
                text: this.translate('invoice.table.vat_row.vat_amount_label', language),
              },
              {
                text: `${billData.currency} 0.00`,
                width: mm2pt(30),
              },
            ],
            padding: 5,
          },
          {
            columns: [
              {
                text: '',
                width: mm2pt(40),
              },
              {
                fontName: 'Helvetica-Bold',
                text: this.translate(
                  transactionType === TransactionType.REFERRAL
                    ? 'invoice.table.credit_total_row.credit_total_label'
                    : 'invoice.table.invoice_total_row.invoice_total_label',
                  language,
                ),
              },
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

        // T&Cs
        const termsAndConditions: PDFColumn = {
          text: this.translate('invoice.terms', language),
          textOptions: { lineGap: 2 },
          fontSize: 10,
          width: mm2pt(170),
          padding: [5, 0, 5, 0],
        };

        // QR-Bill
        let qrBill: SwissQRBill = null;
        if (includeQrBill) {
          rows.push({
            columns: [
              {
                text: this.translate('invoice.info', language),
                textOptions: { oblique: true, lineGap: 2 },
                fontSize: 10,
                width: mm2pt(170),
              },
            ],
          });

          rows.push({ columns: [termsAndConditions] });
          qrBill = new SwissQRBill(billData, { language: language as SupportedInvoiceLanguage });
        } else {
          rows.push({ columns: [termsAndConditions] });
        }

        const table = new Table({ rows, width: mm2pt(170) });
        table.attachTo(pdf);
        qrBill?.attachTo(pdf);

        pdf.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // --- HELPER METHODS --- //
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

  private getCreditor(bankInfo: BankInfoDto): Creditor {
    return {
      account: bankInfo.iban,
      address: bankInfo.street,
      buildingNumber: bankInfo.number,
      city: bankInfo.city,
      country: bankInfo.iban.substring(0, 2).toUpperCase(),
      name: bankInfo.name,
      zip: bankInfo.zip,
    };
  }

  private getDebtor(userData?: UserData): Debtor | undefined {
    if (!userData?.isDataComplete) return undefined;

    const name = userData.completeName;
    const address = userData.address;

    const debtor: Debtor = {
      name,
      address: address.street,
      city: address.city,
      country: address.country.symbol,
      zip: address.zip,
    };
    if (address.houseNumber != null) debtor.buildingNumber = address.houseNumber;

    return debtor;
  }

  private async getTableData(
    statementType: TransactionStatementType,
    txType: TransactionType,
    transaction: Transaction,
    currency: string,
  ): Promise<SwissQRBillTableData> {
    const titleKey =
      statementType === TransactionStatementType.RECEIPT
        ? 'invoice.receipt_title'
        : txType === TransactionType.REFERRAL
        ? 'invoice.credit_title'
        : 'invoice.title';
    const titleAndDate = {
      title: this.translate(titleKey, transaction.userData.language.symbol.toLowerCase(), {
        invoiceId: transaction.id,
      }),
      // TODO: Which date to pick for the receipt (execution date of the transaction)?
      date: statementType === TransactionStatementType.RECEIPT ? transaction.updated : transaction.created,
    };

    switch (txType) {
      case TransactionType.BUY:
        const outputAsset = transaction.buyCrypto?.outputAsset;

        return {
          quantity: transaction.buyCrypto?.outputAmount,
          description: {
            assetDescription: outputAsset.description ?? outputAsset.name,
            assetName: outputAsset.name,
            assetBlockchain: outputAsset.blockchain,
          },
          fiatAmount: transaction.buyCrypto?.inputAmount,
          ...titleAndDate,
        };

      case TransactionType.SELL:
        const inputAsset = transaction.buyFiat?.cryptoInput?.asset;

        return {
          quantity: transaction.buyFiat?.inputAmount,
          description: {
            assetDescription: inputAsset.description ?? inputAsset.name,
            assetName: inputAsset.name,
            assetBlockchain: inputAsset.blockchain,
          },
          fiatAmount: transaction.buyFiat?.outputAmount,
          ...titleAndDate,
        };

      case TransactionType.SWAP:
        const sourceAsset = transaction.buyCrypto?.cryptoInput?.asset;
        const targetAsset = transaction.buyCrypto?.outputAsset;

        return {
          quantity: transaction.buyCrypto?.inputAmount,
          description: {
            sourceDescription: sourceAsset.description ?? sourceAsset.name,
            sourceName: sourceAsset.name,
            sourceBlockchain: sourceAsset.blockchain,
            targetAmount: transaction.buyCrypto?.outputAmount,
            targetDescription: targetAsset.description ?? targetAsset.name,
            targetName: targetAsset.name,
            targetBlockchain: targetAsset.blockchain,
          },
          fiatAmount: currency === 'CHF' ? transaction.buyCrypto?.amountInChf : transaction.buyCrypto?.amountInEur,
          ...titleAndDate,
        };

      case TransactionType.REFERRAL:
        const targetBlockchain = transaction.refReward?.targetBlockchain;
        if (!targetBlockchain) throw new Error('Missing blockchain information for referral');
        const asset = await this.assetService.getNativeAsset(targetBlockchain);
        if (!asset) throw new Error(`Native asset not found for blockchain ${targetBlockchain}`);

        return {
          quantity: transaction.refReward?.outputAmount,
          description: {
            assetName: asset.name,
            assetBlockchain: targetBlockchain,
          },
          fiatAmount: currency === 'CHF' ? transaction.refReward?.amountInChf : transaction.refReward?.amountInEur,
          ...titleAndDate,
        };

      default:
        throw new Error('Unsupported transaction type');
    }
  }
}
