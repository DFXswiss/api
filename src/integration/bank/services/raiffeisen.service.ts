import { Injectable, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BankTx, BankTxIndicator } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { AzureStorageService } from '../../infrastructure/azure-storage.service';

// ebics-client is a CommonJS module
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Client, Orders } = require('ebics-client');

interface EbicsKeyStorage {
  read: () => Promise<string>;
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

interface CamtTransaction {
  accountServiceRef: string;
  bookingDate: Date;
  valueDate: Date;
  amount: number;
  currency: string;
  creditDebitIndicator: 'CRDT' | 'DBIT';
  name?: string;
  iban?: string;
  bic?: string;
  remittanceInfo?: string;
  endToEndId?: string;
}

@Injectable()
export class RaiffeisenService implements OnModuleInit {
  private readonly logger = new DfxLogger(RaiffeisenService);

  private readonly storageContainer = 'ebics';
  private readonly keyFileName = 'raiffeisen/keys.json';

  private client: typeof Client | null = null;
  private isInitialized = false;
  private storageService: AzureStorageService;

  async onModuleInit(): Promise<void> {
    await this.initializeClient();
  }

  private async initializeClient(): Promise<void> {
    const credentials = Config.bank.raiffeisen?.credentials;
    if (!credentials?.url || !credentials?.hostId || !credentials?.partnerId || !credentials?.userId) {
      this.logger.info('Raiffeisen EBICS credentials not configured, skipping initialization');
      return;
    }

    if (!credentials?.passphrase) {
      this.logger.warn('Raiffeisen EBICS passphrase not configured');
      return;
    }

    try {
      // Initialize Azure Storage for key persistence
      this.storageService = new AzureStorageService(this.storageContainer);

      const keyStorage: EbicsKeyStorage = {
        read: async () => this.readKeysFromStorage(),
      };

      this.client = new Client({
        url: credentials.url,
        partnerId: credentials.partnerId,
        userId: credentials.userId,
        hostId: credentials.hostId,
        passphrase: credentials.passphrase,
        keyStorage,
        bankName: 'Raiffeisenbank Waldkirch',
        bankShortName: 'RAIFCH',
        languageCode: 'de',
      });

      // Check if keys exist
      const keys = await this.client.keys();
      this.isInitialized = keys !== null;

      if (this.isInitialized) {
        this.logger.info('Raiffeisen EBICS client initialized with existing keys');
      } else {
        this.logger.info('Raiffeisen EBICS client created, initialization required (INI/HIA)');
      }
    } catch (e) {
      this.logger.error('Failed to initialize Raiffeisen EBICS client:', e);
    }
  }

  // --- KEY STORAGE (Azure Blob) --- //

  private async readKeysFromStorage(): Promise<string> {
    try {
      const blob = await this.storageService.getBlob(this.keyFileName);
      return blob.data.toString('utf-8');
    } catch (e) {
      this.logger.verbose('No EBICS keys found in storage');
      throw new Error('No keys stored');
    }
  }

  // --- EBICS ORDERS --- //

  /**
   * Get bank statements (camt.053 / C53)
   * Requires C53 permission from Raiffeisen
   */
  async getBankStatements(startDate?: Date, endDate?: Date): Promise<EbicsDownloadResult> {
    if (!this.client || !this.isInitialized) {
      throw new Error('Raiffeisen EBICS client not initialized');
    }

    const start = startDate ? Util.isoDate(startDate) : null;
    const end = endDate ? Util.isoDate(endDate) : null;

    this.logger.info(`Fetching C53 (bank statements) from ${start} to ${end}`);
    return this.client.send(Orders.C53(start, end));
  }

  // --- TRANSACTION POLLING --- //

  /**
   * Get Raiffeisen transactions - polls for new transactions via C53 (camt.053)
   * Requires C53 permission from Raiffeisen (needs to be requested)
   */
  async getRaiffeisenTransactions(lastModificationTime: string, accountIban: string): Promise<Partial<BankTx>[]> {
    if (!Config.bank.raiffeisen?.credentials?.url || !this.isInitialized) return [];

    try {
      const fromDate = new Date(lastModificationTime);
      const toDate = Util.daysAfter(1);

      // Fetch bank statements via C53 (camt.053)
      const result = await this.getBankStatements(fromDate, toDate);

      if (!result.orderData) {
        this.logger.verbose('No new transactions from Raiffeisen');
        return [];
      }

      const transactions = this.parseCamt053Xml(result.orderData.toString(), accountIban);
      return transactions.map((t) => this.parseTransaction(t, accountIban));
    } catch (e) {
      this.logger.error('Failed to get Raiffeisen transactions:', e);
      return [];
    }
  }

  // --- CAMT.053 XML PARSING --- //

  /**
   * Parse camt.053 XML (ISO 20022 Bank-to-Customer Statement)
   * Structure: Document > BkToCstmrStmt > Stmt > Ntry (entries)
   */
  private parseCamt053Xml(xmlData: string, accountIban: string): CamtTransaction[] {
    const transactions: CamtTransaction[] = [];

    try {
      // Extract all entries from camt.053
      const entryMatches = xmlData.match(/<Ntry>[\s\S]*?<\/Ntry>/g) || [];

      for (const entry of entryMatches) {
        // Check if entry belongs to the requested account
        const entryIban = this.extractTag(xmlData, 'IBAN');
        if (entryIban && entryIban !== accountIban) continue;

        const tx = this.parseNtryElement(entry);
        if (tx) transactions.push(tx);
      }

      this.logger.info(`Parsed ${transactions.length} transactions from camt.053`);
    } catch (e) {
      this.logger.error('Failed to parse camt.053 XML:', e);
    }

    return transactions;
  }

  /**
   * Parse a single Ntry (Entry) element from camt.053
   */
  private parseNtryElement(entryXml: string): CamtTransaction | null {
    try {
      // Amount and currency
      const amtMatch = entryXml.match(/<Amt\s+Ccy="([^"]+)">([^<]+)<\/Amt>/);
      const amount = amtMatch ? parseFloat(amtMatch[2]) : 0;
      const currency = amtMatch ? amtMatch[1] : 'CHF';

      // Credit/Debit indicator
      const cdtDbtInd = this.extractTag(entryXml, 'CdtDbtInd') as 'CRDT' | 'DBIT';
      if (!cdtDbtInd) return null;

      // Dates
      const bookingDateStr = this.extractTag(entryXml, 'BookgDt');
      const valueDateStr = this.extractTag(entryXml, 'ValDt');
      const bookingDate = bookingDateStr ? this.parseDate(bookingDateStr) : new Date();
      const valueDate = valueDateStr ? this.parseDate(valueDateStr) : bookingDate;

      // Reference
      const acctSvcrRef = this.extractTag(entryXml, 'AcctSvcrRef') || `RAIF-${Date.now()}-${Math.random().toString(36)}`;

      // Transaction details (inside TxDtls)
      const txDtls = entryXml.match(/<TxDtls>[\s\S]*?<\/TxDtls>/)?.[0] || entryXml;

      // Party information
      const name =
        this.extractTag(txDtls, 'Nm') ||
        this.extractNestedTag(txDtls, 'RltdPties', 'Dbtr', 'Nm') ||
        this.extractNestedTag(txDtls, 'RltdPties', 'Cdtr', 'Nm');

      const iban =
        this.extractTag(txDtls, 'IBAN') ||
        this.extractNestedTag(txDtls, 'RltdPties', 'DbtrAcct', 'IBAN') ||
        this.extractNestedTag(txDtls, 'RltdPties', 'CdtrAcct', 'IBAN');

      const bic =
        this.extractTag(txDtls, 'BIC') ||
        this.extractTag(txDtls, 'BICFI') ||
        this.extractNestedTag(txDtls, 'RltdAgts', 'DbtrAgt', 'BIC');

      // Remittance information
      const ustrd = this.extractTag(txDtls, 'Ustrd');
      const strd = this.extractTag(txDtls, 'Strd');
      const remittanceInfo = ustrd || strd;

      // End-to-end ID
      const endToEndId = this.extractTag(txDtls, 'EndToEndId');

      return {
        accountServiceRef: acctSvcrRef,
        bookingDate,
        valueDate,
        amount,
        currency,
        creditDebitIndicator: cdtDbtInd,
        name,
        iban,
        bic,
        remittanceInfo,
        endToEndId,
      };
    } catch (e) {
      this.logger.error('Failed to parse Ntry element:', e);
      return null;
    }
  }

  // --- XML HELPER METHODS --- //

  private extractTag(xml: string, tag: string): string | undefined {
    const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return match?.[1]?.trim();
  }

  private extractNestedTag(xml: string, ...tags: string[]): string | undefined {
    let current = xml;
    for (const tag of tags) {
      const match = current.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`));
      if (!match) return undefined;
      current = match[0];
    }
    // Extract the innermost text
    const textMatch = current.match(/>([^<]+)</);
    return textMatch?.[1]?.trim();
  }

  private parseDate(dateStr: string): Date {
    // camt.053 dates can be in format: <Dt>2025-01-15</Dt> or <DtTm>2025-01-15T10:30:00</DtTm>
    const dateMatch = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
    return dateMatch ? new Date(dateMatch[1]) : new Date();
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
