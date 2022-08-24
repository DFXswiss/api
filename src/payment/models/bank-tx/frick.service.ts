import { AxiosRequestHeaders, Method } from 'axios';
import { Config } from 'src/config/config';
import { HttpError, HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/util';
import { BankTxBatch } from './bank-tx-batch.entity';
import { BankTx, BankTxIndicator, BankTxType } from './bank-tx.entity';
import { BankTxBatchRepository } from './bank-tx-batch.repository';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { In } from 'typeorm';

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

enum TransactionCharge {
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
  SWIFT = 'SWIFT ',
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
  private accessToken = 'access-token-will-be-updated';

  constructor(private readonly http: HttpService, private readonly bankTxBatchService: BankTxBatchRepository) {}

  async getFrickTransactions(lastModificationTime: string): Promise<Partial<BankTx>[]> {
    try {
      if (!Config.bank.frick.key) return;
      const transactions = await this.getTransactions(new Date(lastModificationTime));

      if (!transactions.transactions) return [];

      return transactions.transactions.map((t) => this.parseTransaction(t));
    } catch (e) {
      console.error('Error during get frick transactions:', e);
    }
  }

  async getBalance(): Promise<Account[]> {
    const { accounts } = await this.getAccounts();
    return accounts;
  }

  private async getTransactions(fromDate: Date, toDate: Date = new Date()): Promise<Transactions> {
    const url = `transactions?fromDate=${Util.isoDate(fromDate)}&toDate=${Util.isoDate(
      toDate,
    )}&maxResults=2500&status=BOOKED `;
    return await this.callApi<Transactions>(url);
  }

  async getAccounts(): Promise<Accounts> {
    const url = `accounts`;
    return await this.callApi<Accounts>(url);
  }

  // --- PARSING --- //
  private parseTransaction(tx: Transaction): Partial<BankTx> {
    return {
      accountServiceRef: tx.orderId ? tx.orderId.toString() : tx.transactionNr?.toString(),
      bookingDate: tx.valutaIsExecutionDate ? new Date(tx.valuta) : new Date(tx.bookingDate),
      valueDate: new Date(tx.valuta),
      txCount: 1,
      txId: tx.transactionNr?.toString(),
      ...this.getExchangeInformation(tx),
      amount: this.getPositiveAmount(tx.totalAmount),
      instructedAmount: this.getPositiveAmount(tx.fxTransactionAmount),
      txAmount: this.getPositiveAmount(tx.amount),
      chargeAmount: this.getPositiveAmount(tx.fees),
      currency: tx.currency,
      instructedCurrency: tx.fxTransactionCurrency,
      txCurrency: tx.currency,
      chargeCurrency: tx.fees ? tx.currency : undefined,
      ...this.getCustomerInformation(tx),
      remittanceInfo: tx.reference,
      type: tx.type === TransactionType.INTERNAL ? BankTxType.INTERNAL : null,
      accountIban: tx.direction == TransactionDirection.OUTGOING ? tx.debitor.iban : tx.creditor.iban,
      txInfo: JSON.stringify(tx),
    };
  }

  private getExchangeInformation(tx: Transaction): {
    exchangeRate: number;
    exchangeTargetCurrency: string;
    exchangeSourceCurrency: string;
  } {
    if (!tx.md) return null;
    return {
      exchangeRate: tx.md == 'D' ? tx.fxrate : Util.round(1 / tx.fxrate, 2),
      exchangeTargetCurrency: tx.fxTransactionCurrency,
      exchangeSourceCurrency: tx.currency,
    };
  }

  private getCustomerInformation(tx: Transaction): {
    name?: string;
    addressLine1?: string;
    creditDebitIndicator: BankTxIndicator;
    iban: string;
    country: string;
    city: string;
    memberId: string;
    bankName: string;
    bic: string;
  } {
    const account = tx.direction == TransactionDirection.OUTGOING ? tx.creditor : tx.debitor;
    return {
      name: account.name,
      addressLine1: account.address,
      city: account.city,
      iban: account.iban,
      memberId: account.accountNumber,
      country: account.country,
      bankName: account.creditInstitution,
      creditDebitIndicator:
        tx.direction == TransactionDirection.INCOMING ? BankTxIndicator.CREDIT : BankTxIndicator.DEBIT,
      bic: account.bic,
    };
  }

  private getPositiveAmount(amount: number): number {
    return amount < 0 ? amount * -1 : amount;
  }

  // --- HELPER METHODS --- //

  private async callApi<T>(url: string, method: Method = 'GET', data?: any): Promise<T> {
    return this.request<T>(url, method, data).catch((e: HttpError) => {
      throw new ServiceUnavailableException(e);
    });
  }

  private async request<T>(url: string, method: Method, data?: any, nthTry = 3, getNewAccessToken = false): Promise<T> {
    try {
      if (getNewAccessToken) this.accessToken = await this.getAccessToken();

      return await this.http.request<T>({
        url: `${Config.bank.frick.url}/${url}`,
        method: method,
        data: data,
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
    const data = { key: Config.bank.frick.key, password: Config.bank.frick.password };

    const { token } = await this.http.request<{ token: string }>({
      url: `${Config.bank.frick.url}/authorize`,
      method: 'POST',
      data: data,
      headers: this.getHeaders(data),
    });

    return token;
  }

  private getHeaders(data?: any): AxiosRequestHeaders {
    return {
      Accept: 'application/json',
      algorithm: 'rsa-sha512',
      Signature: data ? Util.createSign(JSON.stringify(data), Config.bank.frick.privateKey, 'sha512') : null,
      Authorization: `Bearer ${this.accessToken}`,
    };
  }
}
