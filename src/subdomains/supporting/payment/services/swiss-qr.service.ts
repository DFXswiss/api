import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import PDFDocument from 'pdfkit';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { BankInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy-payment-info.dto';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { PDFRow, SwissQRBill, Table } from 'swissqrbill/pdf';
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

@Injectable()
export class SwissQRService {
  constructor(private readonly assetService: AssetService, private readonly i18n: I18nService) {}

  createQrCode(
    amount: number,
    currency: 'CHF',
    reference: string,
    bankInfo: BankInfoDto,
    request?: TransactionRequest,
  ): string {
    const data = this.generateQrData(amount, currency, bankInfo, reference, request.user.userData);
    return new SwissQRCode(data).toString();
  }

  async createInvoiceFromRequest(
    amount: number,
    currency: 'CHF' | 'EUR',
    reference: string,
    bankInfo: BankInfoDto,
    request: TransactionRequest,
  ): Promise<string> {
    const data = this.generateQrData(amount, currency, bankInfo, reference, request.user.userData);

    if (!data.debtor) {
      throw new Error('Debtor is required');
    }

    const userLanguage = request.user.userData.language.symbol.toUpperCase();
    const language = this.isSupportedInvoiceLanguage(userLanguage) ? userLanguage : 'EN';

    const asset = await this.assetService.getAssetById(request.targetId);
    const assetAmount = request.estimatedAmount;

    return this.generatePdfInvoice(
      data,
      language,
      asset,
      assetAmount,
      amount,
      currency,
      request.id,
      true,
      TransactionType.BUY,
    );
  }

  async createInvoiceFromTx(
    amount: number,
    currency: string, // Allow CHF, EUR and crypto
    bankInfo: BankInfoDto,
    transaction: Transaction,
    txType: TransactionType,
    reference?: string,
  ): Promise<string> {
    const data = this.generateQrData(amount, currency, bankInfo, reference, transaction.user.userData);

    if (!data.debtor) {
      throw new Error('Debtor is required');
    }

    const userLanguage = transaction.user.userData.language.symbol.toUpperCase();
    const language = this.isSupportedInvoiceLanguage(userLanguage) ? userLanguage : 'EN';

    let asset: Asset;
    let assetAmount: number;

    // First try to identify by the transaction type
    switch (txType) {
      case TransactionType.SWAP:
        asset = transaction.buyCrypto?.cryptoInput?.asset;
        assetAmount = transaction.buyCrypto?.inputAmount;
        break;
      case TransactionType.BUY:
        asset = transaction.buyCrypto?.outputAsset;
        assetAmount = transaction.buyCrypto?.outputAmount;
        break;
      case TransactionType.SELL:
        asset = transaction.buyFiat?.cryptoInput?.asset;
        assetAmount = transaction.buyFiat?.inputAmount;
        break;
      default:
        throw new Error('Unsupported transaction type');
    }

    if (!asset) throw new Error('Asset information missing in transaction');

    return this.generatePdfInvoice(
      data,
      language,
      asset,
      assetAmount,
      amount,
      currency,
      transaction.uid,
      false,
      txType,
    );
  }

  private generatePdfInvoice(
    data: QrBillData,
    language: string,
    asset: Asset,
    assetAmount: number,
    amount: number,
    currency: string,
    invoiceId: number | string,
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
          `${data.creditor.name}\n${data.creditor.address} ${data.creditor.buildingNumber}\n${data.creditor.zip} ${data.creditor.city}`,
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
          `${data.debtor.name}\n${data.debtor.address} ${data.debtor.buildingNumber}\n${data.debtor.zip} ${data.debtor.city}`,
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
        pdf.text(this.translate('invoice.title', language, { invoiceId }), mm2pt(20), mm2pt(100), {
          align: 'left',
          width: mm2pt(170),
        });

        // Date
        const date = new Date();
        pdf.fontSize(11);
        pdf.font('Helvetica');
        pdf.text(`Zug ${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`, {
          align: 'right',
          width: mm2pt(170),
        });

        // Table
        const rows: PDFRow[] = [
          {
            backgroundColor: '#4A4D51',
            columns: [
              {
                text: this.translate('invoice.table.headers.quantity', language),
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
                text:
                  transactionType === TransactionType.SWAP ? this.formatCryptoAmount(assetAmount) : `${assetAmount}`,
                width: mm2pt(40),
              },
              {
                text: this.translate(
                  `invoice.table.position_row.${transactionType.toLowerCase()}_description`,
                  language,
                  {
                    assetDescription: asset.description ?? asset.name,
                    assetName: asset.name,
                    assetBlockchain: asset.blockchain,
                  },
                ),
              },
              {
                text:
                  transactionType === TransactionType.SWAP
                    ? `${currency} ${this.formatCryptoAmount(amount)}` // Format crypto nicely
                    : `${currency} ${amount.toFixed(2)}`, // Standard 2 decimals for fiat
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
                text:
                  transactionType === TransactionType.SWAP
                    ? `${currency} ${this.formatCryptoAmount(amount)}`
                    : `${currency} ${amount.toFixed(2)}`,
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
                text: transactionType === TransactionType.SWAP ? `${currency} 0.00000000` : `${currency} 0.00`,
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
                text: this.translate('invoice.table.invoice_total_row.invoice_total_label', language),
              },
              {
                fontName: 'Helvetica-Bold',
                text:
                  transactionType === TransactionType.SWAP
                    ? `${currency} ${this.formatCryptoAmount(amount)}`
                    : `${currency} ${amount.toFixed(2)}`,
                width: mm2pt(30),
              },
            ],
            height: 40,
            padding: 5,
          },
        ];

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
          qrBill = new SwissQRBill(data, { language: language as SupportedInvoiceLanguage });
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
  private isSupportedInvoiceLanguage(lang: string): lang is SupportedInvoiceLanguage {
    return Object.keys(SupportedInvoiceLanguage).includes(lang);
  }

  private translate(key: string, lang: string, args?: any): string {
    return this.i18n.translate(key, { lang: lang.toLowerCase(), args });
  }

  // TODO: How many decimals should be shown for crypto?
  private formatCryptoAmount(amount: number): string {
    if (amount < 0.001) return amount.toFixed(8);
    if (amount < 0.01) return amount.toFixed(6);
    if (amount < 1) return amount.toFixed(4);
    return amount.toFixed(2);
  }

  private generateQrData(
    amount: number,
    currency: string,
    bankInfo: BankInfoDto,
    reference?: string,
    userData?: UserData,
  ): QrBillData {
    // TODO: Is there a cleaner solution to handle the currency?
    const qrCurrency = ['CHF', 'EUR'].includes(currency) ? (currency as 'CHF' | 'EUR') : 'CHF';
    return {
      amount,
      currency: qrCurrency,
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
}
