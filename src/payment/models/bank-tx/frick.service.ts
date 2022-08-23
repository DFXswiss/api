import { AxiosRequestHeaders, Method } from 'axios';
import { Config } from 'src/config/config';
import { HttpError, HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/util';
import { BankTxBatch } from './bank-tx-batch.entity';
import { BankTx, BankTxIndicator, BankTxType } from './bank-tx.entity';
import { BankTxBatchRepository } from './bank-tx-batch.repository';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';

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
  valutalsExecutionDate: boolean;
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
  private readonly baseUrl = Config.bank.frick.url;
  private accessToken = 'access-token-will-be-updated';
  private bankTxBatch: BankTxBatch;

  constructor(private readonly http: HttpService, private readonly bankTxBatchService: BankTxBatchRepository) {
    this.getTest();
  }

  // TODO: remove
  async getTest(): Promise<void> {
    const token = await this.getBalance();
    console.log(token);
  }

  async getFrickTransactions(lastModificationTime: string, iban: string): Promise<Partial<BankTx>[]> {
    try {
      this.bankTxBatch = await this.bankTxBatchService.findOne({ where: { iban } });
      return await this.getTransactions(new Date(lastModificationTime), Util.daysAfter(1), iban).then((t) =>
        t.transactions.map((t) => this.parseTransaction(t)),
      );
    } catch {
      console.error('Error during get frick transactions');
    }
  }

  private async getTransactions(fromDate: Date, toDate: Date = new Date(), iban: string): Promise<Transactions> {
    const url = `transactions?fromDate=${Util.isoDate(fromDate)}&toDate=${Util.isoDate(toDate)}&iban=${iban}`;
    return await this.callApi<Transactions>(url);
  }

  async getAccounts(): Promise<Accounts> {
    const url = `accounts`;
    return await this.callApi<Accounts>(url);
  }

  async getBalance(): Promise<Account[]> {
    const { accounts } = await this.getAccounts();
    return accounts;
  }

  // --- PARSING --- //
  private parseTransaction(tx: Transaction): Partial<BankTx> {
    return {
      accountServiceRef: tx.transactionNr.toString(),
      bookingDate: new Date(tx.bookingDate),
      valueDate: new Date(tx.valuta),
      txCount: 1,
      amount: tx.totalAmount,
      instructedAmount: tx.fxTransactionAmount,
      txAmount: tx.totalAmount,
      chargeAmount: 0,
      currency: tx.currency,
      instructedCurrency: tx.fxTransactionCurrency,
      txCurrency: tx.currency,
      chargeCurrency: tx.currency,
      creditDebitIndicator: tx.direction == TransactionDirection.OUTGOING ? 'CRDT' : 'DBIT',
      ...this.getCustomerInformation,
      remittanceInfo: tx.reference,
      type: tx.type === TransactionType.INTERNAL ? BankTxType.INTERNAL : null,
      batch: this.bankTxBatch,
      txInfo: JSON.stringify(tx),
    };
  }

  private getCustomerInformation(tx: Transaction): {
    name?: string;
    addressLine1?: string;
    direction: BankTxIndicator;
    iban: string;
    country: string;
  } {
    const account = tx.direction == TransactionDirection.INCOMING ? tx.creditor : tx.debitor;
    return {
      name: account.name,
      addressLine1: account.address,
      iban: account.iban,
      country: account.country,
      direction: tx.direction == TransactionDirection.INCOMING ? BankTxIndicator.DEBIT : BankTxIndicator.CREDIT,
    };
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
        url: `${this.baseUrl}/${url}`,
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
      url: `${this.baseUrl}/authorize`,
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
