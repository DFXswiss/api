import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import PDFDocument from 'pdfkit';
import { Config } from 'src/config/config';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LogoSize, PdfBrand, PdfUtil } from 'src/shared/utils/pdf.util';
import { BankInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy-payment-info.dto';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
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

    // Use EUR-specific IBAN for EUR invoices
    if (currency === 'EUR') {
      bankInfo = { ...bankInfo, iban: 'CH8583019DFXSWISSEURX' };
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
      date: request.created,
    };

    return this.generatePdfInvoice(tableData, language, data, true, TransactionType.BUY);
  }

  async createTxStatement(
    { statementType, transactionType, transaction, currency, bankInfo, reference, request }: TxStatementDetails,
    brand: PdfBrand = PdfBrand.DFX,
  ): Promise<string> {
    const debtor = this.getDebtor(transaction.userData);
    if (!debtor) throw new Error('Debtor is required');

    currency = Config.invoice.currencies.includes(currency) ? currency : Config.invoice.defaultCurrency;
    if (!this.isSupportedInvoiceCurrency(currency)) {
      throw new Error('PDF invoice is only available for CHF and EUR transactions');
    }

    const userLanguage = transaction.userData.language.symbol.toUpperCase();
    const language = this.isSupportedInvoiceLanguage(userLanguage) ? userLanguage : 'EN';
    const tableData = await this.getTableData(statementType, transactionType, transaction, currency, request);

    const defaultCreditor = brand === PdfBrand.REALUNIT ? this.realunitCreditor() : this.dfxCreditor();
    const amount = request?.amount ?? transaction.buyCrypto?.inputAmount;
    const billData: QrBillData = {
      creditor: (bankInfo && this.getCreditor(bankInfo)) || (defaultCreditor as unknown as Creditor),
      debtor,
      currency,
      amount: bankInfo && amount,
      message: reference,
    };

    return this.generatePdfInvoice(tableData, language, billData, !!bankInfo, transactionType, brand);
  }

  private generatePdfInvoice(
    tableData: SwissQRBillTableData,
    language: string,
    billData: QrBillData,
    includeQrBill: boolean,
    transactionType: TransactionType,
    brand: PdfBrand = PdfBrand.DFX,
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
        PdfUtil.drawLogo(pdf, brand, LogoSize.LARGE);

        // Sender address
        const sender = brand === PdfBrand.REALUNIT ? this.realunitCreditor() : this.dfxCreditor();
        pdf.fontSize(12);
        pdf.fillColor('black');
        pdf.font('Helvetica');
        pdf.text(
          `${sender.name}\n${sender.address} ${sender.buildingNumber}\n${sender.zip} ${sender.city}`,
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
        const addressLine = [billData.debtor.address, billData.debtor.buildingNumber].filter(Boolean).join(' ');
        const cityLine = [billData.debtor.zip, billData.debtor.city].filter(Boolean).join(' ');
        pdf.text([billData.debtor.name, addressLine, cityLine].filter(Boolean).join('\n'), mm2pt(130), mm2pt(60), {
          align: 'left',
          height: mm2pt(50),
          width: mm2pt(70),
        });

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

    const debtor: Debtor = {
      name,
      address: address?.street ?? '',
      city: address?.city ?? '',
      country: address?.country?.symbol ?? '',
      zip: address?.zip ?? '',
    };
    if (address?.houseNumber != null) debtor.buildingNumber = address.houseNumber;

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
      }

      case TransactionType.SELL: {
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
      }

      case TransactionType.SWAP: {
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
      }

      case TransactionType.REFERRAL: {
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
      }

      default:
        throw new Error('Unsupported transaction type');
    }
  }
}
