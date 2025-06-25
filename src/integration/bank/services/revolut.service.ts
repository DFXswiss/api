import { Injectable } from '@nestjs/common';
import { Method } from 'axios';
import { stringify } from 'qs';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { BankTx, BankTxIndicator } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';

interface Transaction {
  id: string;
  type: TransactionType;
  request_id?: string;
  state: TransactionState;
  reason_code?: string;
  created_at: Date;
  updated_at: Date;
  completed_at?: Date;
  scheduled_for?: Date;
  related_transaction_id?: string;
  merchant?: TransactionMerchant;
  reference?: string;
  legs: TransactionLeg[];
  card: TransactionCard;
}

interface Account {
  id: string;
  name: string;
  balance: number;
  currency: string;
  state: string;
  public: boolean;
  created_at: Date;
  updated_at: Date;
}

interface TokenAuth {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

interface TransactionMerchant {
  name: string;
  city: string;
  category_code: string;
  country: string;
}

interface TransactionLeg {
  leg_id: string;
  amount: number;
  fee?: number;
  currency: string;
  bill_amount?: number;
  bill_currency?: string;
  account_id: string;
  counterparty?: string;
  description?: string;
  balance?: number;
}

interface TransactionCard {
  card_number: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

enum TransactionState {
  CREATED = 'created',
  PENDING = 'pending',
  COMPLETED = 'completed',
  DECLINED = 'declined',
  FAILED = 'failed',
  REVERTED = 'reverted',
}

enum TransactionType {
  ATM = 'atm',
  CARD_PAYMENT = 'card_payment',
  CARD_REFUND = 'card_refund',
  CARD_CHARGEBACK = 'card_chargeback',
  CARD_CREDIT = 'card_credit',
  EXCHANGE = 'exchange',
  TRANSFER = 'transfer',
  LOAN = 'loan',
  FEE = 'fee',
  REFUND = 'refund',
  TOP_UP = 'topup',
  TOP_UP_RETURN = 'topup_return',
  TAX = 'tax',
  TAX_REFUND = 'tax_refund',
}

@Injectable()
export class RevolutService {
  private readonly logger: DfxLogger;
  private readonly baseUrl = 'https://b2b.revolut.com/api/1.0';
  private readonly loginUrl = 'https://b2b.revolut.com/api/1.0/auth/token';

  private accessToken = 'access-token-will-be-updated';

  constructor(private readonly http: HttpService, readonly loggerFactory: LoggerFactory) {
    this.logger = loggerFactory.create(RevolutService);
  }

  async getRevolutTransactions(lastModificationTime: string, accountIban: string): Promise<Partial<BankTx>[]> {
    if (!Config.bank.revolut.clientAssertion || !Config.bank.revolut.refreshToken) return [];

    try {
      const transactions = await this.getTransactions(new Date(lastModificationTime), Util.daysAfter(1));
      if (!transactions) return [];

      return transactions.map((t) => t.legs.map((l) => this.parseTransaction(t, l, accountIban))).flat();
    } catch (e) {
      this.logger.error(`Failed to get Revolut transactions:`, e);
      return [];
    }
  }

  private async getTransactions(fromDate: Date, toDate: Date = new Date()): Promise<Transaction[]> {
    const url = `transactions?from=${Util.isoDate(fromDate)}&to=${Util.isoDate(toDate)}`;
    return this.callApi<Transaction[]>(url);
  }

  async getBalances(): Promise<Account[]> {
    const url = `accounts`;
    return this.callApi<Account[]>(url);
  }

  // --- PARSING --- //
  private parseTransaction(tx: Transaction, txLeg: TransactionLeg, accountIban: string): Partial<BankTx> {
    try {
      return {
        accountServiceRef: txLeg.leg_id,
        bookingDate: tx.created_at,
        valueDate: tx.completed_at,
        txCount: 1,
        instructionId: tx.reference,
        amount: Math.abs(txLeg.amount),
        instructedAmount: Math.abs(txLeg.amount),
        txAmount: Math.abs(txLeg.amount),
        chargeAmount: 0,
        currency: txLeg.currency,
        instructedCurrency: txLeg.currency,
        txCurrency: txLeg.currency,
        chargeCurrency: txLeg.currency,
        creditDebitIndicator: txLeg.amount < 0 ? BankTxIndicator.DEBIT : BankTxIndicator.CREDIT,
        iban: null,
        ...this.getNameAndAddress(txLeg),
        txInfo: tx.reference,
        txRaw: JSON.stringify(tx),
        endToEndId: tx.type,
        txId: tx.state,
        remittanceInfo: tx.reference,
        accountIban: accountIban,
        type: null,
      };
    } catch (e) {
      throw new Error(`Failed to parse transaction ${stringify(tx)}: ${e.message}`);
    }
  }

  private getNameAndAddress(txLeg: TransactionLeg): { name?: string } {
    return { name: txLeg.description.replace('Payment from ', '').replace('From ', '').replace('To ', '') };
  }

  // --- HELPER METHODS --- //
  private async callApi<T>(url: string, method: Method = 'GET', data?: any): Promise<T> {
    return this.request<T>(url, method, data);
  }

  private async request<T>(url: string, method: Method, data?: any, nthTry = 3, getNewAccessToken = false): Promise<T> {
    try {
      if (getNewAccessToken) {
        const tokenAuth = await this.getTokenAuth();
        this.accessToken = tokenAuth.access_token;
      }
      return await this.http.request<T>({
        url: `${this.baseUrl}/${url}`,
        method: method,
        data: data,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/json',
        },
      });
    } catch (e) {
      if (nthTry > 1 && e.response.status == 401) {
        return this.request(url, method, data, nthTry - 1, true);
      }
      throw e;
    }
  }

  private async getTokenAuth(): Promise<TokenAuth> {
    const data = stringify({
      grant_type: 'refresh_token',
      refresh_token: Config.bank.revolut.refreshToken,
      client_assertion: Config.bank.revolut.clientAssertion,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    });

    return this.http.request<TokenAuth>({
      url: this.loginUrl,
      method: 'POST',
      data: data,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }
}
