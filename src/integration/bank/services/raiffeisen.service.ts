import { Injectable } from '@nestjs/common';
import { Client, Orders } from 'ebics-client';
import { GetConfig } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BankTx, BankTxIndicator } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { EbicsKeyEncryptor } from './ebics-key-encryptor';
import { CamtTransaction, Iso20022Service, Pain001Payment } from './iso20022.service';

enum CamtOrderType {
  C52 = 'C52',
  C53 = 'C53',
  C54 = 'C54',
}

interface EbicsKeyStorage {
  read: () => Promise<string>;
  write: (data: string) => Promise<void>;
}

interface EbicsDownloadResult {
  orderData: Buffer | string;
  orderId: string;
  technicalCode: string;
  technicalCodeSymbol: string;
  technicalCodeShortText: string;
  technicalCodeMeaning: string;
  businessCode: string;
  businessCodeSymbol: string;
  businessCodeShortText: string;
  businessCodeMeaning: string;
  bankKeys?: unknown;
}

@Injectable()
export class RaiffeisenService {
  private readonly logger = new DfxLogger(RaiffeisenService);

  private static readonly KEYS_SETTING_KEY = 'raiffeisenEbicsKeys';

  private readonly client: typeof Client;

  constructor(private readonly settingService: SettingService) {
    this.client = this.initializeClient();
  }

  private initializeClient(): typeof Client | undefined {
    const credentials = GetConfig().bank.raiffeisen.credentials;
    if (!credentials.userId) return;

    try {
      const keyStorage: EbicsKeyStorage = {
        read: async () => this.settingService.get(RaiffeisenService.KEYS_SETTING_KEY),
        write: async (data: string) => this.settingService.set(RaiffeisenService.KEYS_SETTING_KEY, data),
      };

      const client = new Client({
        url: credentials.url,
        partnerId: credentials.partnerId,
        userId: credentials.userId,
        hostId: credentials.hostId,
        passphrase: Buffer.from(credentials.passphrase, 'hex'),
        iv: Buffer.from(credentials.iv, 'hex'),
        keyStorage,
        bankName: 'Raiffeisenbank Waldkirch',
        bankShortName: 'RAIFCH',
        languageCode: 'de',
      });

      // fix EBICS client IV bug
      (client as any).keyEncryptor = new EbicsKeyEncryptor(credentials.passphrase, credentials.iv);

      return client;
    } catch (e) {
      this.logger.error('Failed to initialize Raiffeisen EBICS client:', e);
    }
  }

  // --- TRANSACTION POLLING --- //

  async getRaiffeisenIntradayTransactions(
    lastModificationTime: string,
    accountIban: string,
  ): Promise<Partial<BankTx>[]> {
    return this.getTransactions(lastModificationTime, accountIban, CamtOrderType.C52);
  }

  async getRaiffeisenTransactions(lastModificationTime: string, accountIban: string): Promise<Partial<BankTx>[]> {
    return this.getTransactions(lastModificationTime, accountIban, CamtOrderType.C53);
  }

  async getRaiffeisenNotifications(lastModificationTime: string, accountIban: string): Promise<Partial<BankTx>[]> {
    return this.getTransactions(lastModificationTime, accountIban, CamtOrderType.C54);
  }

  private async getTransactions(
    lastModificationTime: string,
    accountIban: string,
    orderType: CamtOrderType,
  ): Promise<Partial<BankTx>[]> {
    try {
      const fromDate = new Date(lastModificationTime);
      const toDate = Util.daysAfter(1);

      const result = await this.getEbicsData(fromDate, toDate, orderType);

      if (!result.orderData) return [];

      const transactions = Iso20022Service.parseCamtXml(result.orderData.toString(), accountIban);
      return transactions.map((t) => this.parseTransaction(t, accountIban));
    } catch (e) {
      this.logger.error(`Failed to get Raiffeisen ${orderType} transactions:`, e);
      return [];
    }
  }

  // --- PAYMENT INITIATION --- //

  async sendPayment(payment: Pain001Payment): Promise<EbicsDownloadResult> {
    if (!this.client) throw new Error('Raiffeisen EBICS client not initialized');

    const pain001Xml = Iso20022Service.createPain001Xml(payment);

    const order = payment.currency === 'EUR' ? Orders.CCT(pain001Xml) : Orders.XE3(pain001Xml);
    return this.client.send(order);
  }

  // --- EBICS ORDERS --- //

  private async getEbicsData(
    startDate: Date | undefined,
    endDate: Date | undefined,
    orderType: CamtOrderType,
  ): Promise<EbicsDownloadResult> {
    if (!this.client) throw new Error('Raiffeisen EBICS client not initialized');

    const start = startDate ? Util.isoDate(startDate) : null;
    const end = endDate ? Util.isoDate(endDate) : null;

    const order = this.createEbicsOrder(orderType, start, end);
    return this.client.send(order);
  }

  private createEbicsOrder(orderType: CamtOrderType, start: string | null, end: string | null) {
    switch (orderType) {
      case CamtOrderType.C52:
        return Orders.C52(start, end);

      case CamtOrderType.C53:
        return Orders.C53(start, end);

      case CamtOrderType.C54:
        // C54 is not predefined
        return {
          version: 'h004',
          orderDetails: {
            OrderType: CamtOrderType.C54,
            OrderAttribute: 'DZHNN',
            StandardOrderParams: start && end ? { DateRange: { Start: start, End: end } } : {},
          },
          operation: 'download',
        };
    }
  }

  // --- TRANSACTION MAPPING --- //

  private parseTransaction(tx: CamtTransaction, accountIban: string): Partial<BankTx> {
    return {
      accountServiceRef: tx.accountServiceRef,
      bookingDate: tx.bookingDate,
      valueDate: tx.valueDate,
      txCount: 1,
      amount: tx.amount,
      instructedAmount: tx.amount,
      txAmount: tx.amount,
      chargeAmount: 0,
      currency: tx.currency,
      instructedCurrency: tx.currency,
      txCurrency: tx.currency,
      chargeCurrency: tx.currency,
      creditDebitIndicator: tx.creditDebitIndicator === 'CRDT' ? BankTxIndicator.CREDIT : BankTxIndicator.DEBIT,
      iban: tx.iban,
      bic: tx.bic,
      name: tx.name,
      remittanceInfo: tx.remittanceInfo,
      endToEndId: tx.endToEndId,
      accountIban: accountIban,
      type: null,
    };
  }
}
