import { Injectable } from '@nestjs/common';
import { Method, RawAxiosRequestHeaders } from 'axios';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { BankTx, BankTxIndicator, BankTxType } from './bank-tx.entity';

interface Transactions {
  moreResults: boolean;
  resultSetSize: number;
  transactions: Transaction[];
}

interface Transaction {
  orderId: number;
  customId: string;
  transactionNr: number;
  serviceType: ServiceType;
  type: TransactionType;
  state: TransactionState;
  transactionCode: string;
  fees: number;
  fxrate: number;
  fxPair: string;
  fxTransactionAmount: number;
  fxTransactionCurrency: string;
  md: MD;
  amount: number;
  totalAmount: number;
  currency: string;
  express: boolean;
  valuta: string;
  bookingDate: string;
  valutaIsExecutionDate: boolean;
  reference: string;
  charge: TransactionCharge;
  correspondence: boolean;
  direction: TransactionDirection;
  orderingCustomer: OrderingCustomer;
  debitor: TransactionAccount;
  creditor: TransactionAccount;
  creator: string;
  createDate: string;
  right: string;
  groupPolicy: string;
  group: string;
  quorum: number;
  approvals: TransactionApproval[];
}

interface Accounts {
  date: Date;
  moreResults: boolean;
  resultSetSize: number;
  accounts: Account[];
}

interface Account {
  account: string;
  type: string;
  iban: string;
  customer: string;
  currency: string;
  balance: number;
  available: number;
}

interface TransactionAccount {
  accountNumber: string;
  aba: string;
  iban: string;
  name: string;
  address: string;
  postalcode: string;
  city: string;
  country: string;
  bic: string;
  creditInstitution: string;
  esr: string;
}

interface OrderingCustomer {
  name: string;
  address: string;
  postalcode: string;
  city: string;
  country: string;
}

interface TransactionApproval {
  contact: string;
  group: number;
  dateOfApproval: string;
}

enum TransactionDirection {
  INCOMING = 'incoming',
  OUTGOING = 'outgoing',
  RETURN = 'return',
}

export enum TransactionCharge {
  BEN = 'BEN',
  OUR = 'OUR',
  SHA = 'SHA',
}

enum MD {
  M = 'M',
  D = 'D',
}

enum TransactionType {
  INTERNAL = 'INTERNAL',
  BANK_INTERNAL = 'BANK_INTERNAL',
  SEPA = 'SEPA',
  FOREIGN = 'FOREIGN',
  RED = 'RED',
  ORANGE = 'ORANGE',
}

enum ServiceType {
  SWIFT = 'SWIFT',
  SIC = 'SIC',
  EUROSIC = 'EUROSIC',
}

enum TransactionState {
  PREPARED = 'PREPARED',
  IN_PROGRESS = 'IN_PROGRESS',
  DELETED = 'DELETED',
  EXPIRED = 'EXPIRED',
  EXECUTED = 'EXECUTED',
  REJECTED = 'REJECTED',
  ERROR = 'ERROR',
  DELETION_REQUESTED = 'DELETION_REQUESTED',
  BOOKED = 'BOOKED',
}

@Injectable()
export class FrickService {
  private readonly logger = new DfxLogger(FrickService);

  private accessToken = 'access-token-will-be-updated';

  constructor(private readonly http: HttpService) {}

  async getFrickTransactions(lastModificationTime: string): Promise<Partial<BankTx>[]> {
    if (!Config.bank.frick.credentials.key) return [];

    try {
      const transactions = await this.getTransactions(new Date(lastModificationTime));
      if (!transactions) return [];

      // get additional information (required for ABA transactions)
      for (const transaction of transactions) {
        if (transaction.serviceType == ServiceType.SWIFT && transaction.orderId) {
          const txDetail = await this.getTransaction(transaction.orderId);
          transaction.creditor = { ...transaction.creditor, ...txDetail?.creditor };
          transaction.debitor = { ...transaction.debitor, ...txDetail?.debitor };
        }
      }
      return transactions.map((t) => this.parseTransaction(t));
    } catch (e) {
      this.logger.error(`Failed to get Bank Frick transactions:`, e);
      return [];
    }
  }

  async getBalance(): Promise<Account[]> {
    const { accounts } = await this.getAccounts();
    return accounts;
  }

  private async getTransactions(fromDate: Date, toDate: Date = new Date()): Promise<Transaction[]> {
    const params = {
      fromDate: Util.isoDate(fromDate),
      toDate: Util.isoDate(toDate),
      maxResults: 2500,
      status: TransactionState.BOOKED,
    };
    const transactions = await this.callApi<Transactions>(`transactions`, 'GET', params);
    return transactions?.transactions;
  }

  private async getTransaction(orderId: number): Promise<undefined | Transaction> {
    const { transactions } = await this.callApi<Transactions>(`transactions/${orderId}`, 'GET');
    return transactions?.[0];
  }

  async getAccounts(): Promise<Accounts> {
    const url = `accounts`;
    return this.callApi<Accounts>(url);
  }

  // --- PARSING --- //
  private parseTransaction(tx: Transaction): Partial<BankTx> {
    try {
      return {
        accountServiceRef: (tx.orderId ?? tx.transactionNr)?.toString(),
        bookingDate: tx.valutaIsExecutionDate ? new Date(tx.valuta) : new Date(tx.bookingDate),
        valueDate: new Date(tx.valuta),
        txCount: 1,
        txId: tx.transactionNr?.toString(),
        ...this.getExchangeInformation(tx),
        amount: Math.abs(tx.totalAmount),
        instructedAmount: tx.fxTransactionAmount ? Math.abs(tx.fxTransactionAmount) : Math.abs(tx.amount),
        txAmount: Math.abs(tx.amount),
        chargeAmount: tx.fees ? Math.abs(tx.fees) : 0,
        currency: tx.currency,
        instructedCurrency: tx.fxTransactionCurrency ?? tx.currency,
        txCurrency: tx.currency,
        chargeCurrency: tx.currency,
        ...this.getCustomerInformation(tx),
        creditDebitIndicator: tx.amount > 0 ? BankTxIndicator.CREDIT : BankTxIndicator.DEBIT,
        remittanceInfo: tx.reference,
        type: tx.type === TransactionType.INTERNAL ? BankTxType.INTERNAL : null,
        accountIban: tx.direction == TransactionDirection.OUTGOING ? tx.debitor.iban : tx.creditor.iban,
        txRaw: JSON.stringify(tx),
      };
    } catch (e) {
      throw new Error(`Failed to parse transaction ${tx.orderId ?? tx.transactionNr}: ${e.message}`);
    }
  }

  private getExchangeInformation(tx: Transaction): {
    exchangeRate: number;
    exchangeTargetCurrency: string;
    exchangeSourceCurrency: string;
  } {
    if (!tx.md) return null;
    return {
      exchangeRate: tx.md == MD.D ? tx.fxrate : Util.round(1 / tx.fxrate, 2),
      exchangeTargetCurrency: tx.fxTransactionCurrency,
      exchangeSourceCurrency: tx.currency,
    };
  }

  private getCustomerInformation(tx: Transaction): {
    name?: string;
    addressLine1?: string;
    iban: string;
    aba: string;
    country: string;
    city: string;
    memberId: string;
    bankName: string;
    bic: string;
  } {
    const account = tx.direction == TransactionDirection.OUTGOING ? tx.creditor : tx.debitor;
    if (!account) return undefined;
    return {
      aba: account.aba,
      addressLine1: account.address,
      bankName: account.creditInstitution,
      bic: account.bic,
      country: account.country,
      city: account.city,
      iban: account.iban,
      memberId: account.accountNumber,
      name: account.name,
    };
  }

  // --- HELPER METHODS --- //

  private async callApi<T>(url: string, method: Method = 'GET', data?: any): Promise<T> {
    return this.request<T>(url, method, data);
  }

  private async request<T>(url: string, method: Method, data?: any, nthTry = 3, getNewAccessToken = false): Promise<T> {
    try {
      if (getNewAccessToken) this.accessToken = await this.getAccessToken();

      return await this.http.request<T>({
        url: `${Config.bank.frick.credentials.url}/${url}`,
        method: method,
        data: method !== 'GET' ? data : undefined,
        params: method === 'GET' ? data : undefined,
        headers: this.getHeaders(data),
      });
    } catch (e) {
      if (nthTry > 1 && e.response?.status == 401) {
        return this.request(url, method, data, nthTry - 1, true);
      }
      throw e;
    }
  }

  private async getAccessToken(): Promise<string> {
    const data = { key: Config.bank.frick.credentials.key, password: Config.bank.frick.credentials.password };

    const { token } = await this.http.request<{ token: string }>({
      url: `${Config.bank.frick.credentials.url}/authorize`,
      method: 'POST',
      data: data,
      headers: this.getHeaders(data),
    });

    return token;
  }

  private getHeaders(data?: any): RawAxiosRequestHeaders {
    return {
      Accept: 'application/json',
      algorithm: 'rsa-sha512',
      Signature: data
        ? Util.createSign(JSON.stringify(data), Config.bank.frick.credentials.privateKey, 'sha512')
        : null,
      Authorization: `Bearer ${this.accessToken}`,
    };
  }
}
