import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Method } from 'axios';
import { Config } from 'src/config/config';
import { HttpError, HttpService } from 'src/shared/services/http.service';

export interface Transaction {
  idCtp: number;
  dateEcriture: number[];
  dateValeur: number[];
  codeInterbancaireInterne: TransactionType;
  codeInterbancaire: string;
  credit: number;
  debit: number;
  line1: string;
  line2: string;
  instructingIban: string;
}

export interface Balance {
  balance: number;
  balanceOperationYesterday: number;
}

enum TransactionType {
  RECEIVED = 'SCT_RECEIVED',
  SENT = 'SCT_SENT',
  BILLING = 'BILLING',
}

@Injectable()
export class OlkyPayService {
  private readonly baseUrl = 'https://ws.olkypay.com/reporting/';
  private readonly loginUrl = 'https://stp.olkypay.com/auth/realms/b2b/protocol/openid-connect/token';
  private accessToken = 'access-token-will-be-updated';

  constructor(private readonly http: HttpService) {}

  // --- TRANSACTION HANDLING --- //
  @Interval(18000)
  async checkInputs(): Promise<void> {
    const toDate = new Date();
    const fromDate = new Date(toDate.setHours(toDate.getHours() - 1));
    const newTransactions = await this.getTransactions(fromDate, toDate);
  }

  async getTransactions(fromDate: Date = new Date(), toDate: Date = new Date()): Promise<Transaction[]> {
    const url = `ecritures/${Config.bank.olkyPay.clientId}/${fromDate.toISOString().split('T')[0]}/${
      toDate.toISOString().split('T')[0]
    }`;

    try {
      return await this.callApi<Transaction[]>(url);
    } catch (error) {
      throw new ServiceUnavailableException(`Failed to get Transactions:`, error);
    }
  }

  async getBalance(): Promise<Balance> {
    const url = `balance/today/${Config.bank.olkyPay.clientId}`;

    try {
      return await this.callApi<Balance>(url);
    } catch (error) {
      throw new ServiceUnavailableException(`Failed to get Balance:`, error);
    }
  }

  private async callApi<T>(url: string, method: Method = 'GET', data?: any): Promise<T> {
    return this.request<T>(url, method, data).catch((e: HttpError) => {
      throw new ServiceUnavailableException(e);
    });
  }

  private async request<T>(url: string, method: Method, data?: any): Promise<T> {
    try {
      this.accessToken = await this.getAccessToken();
      return await this.http.request<T>({
        url: `${this.baseUrl}${url}`,
        method: method,
        data: data,
        headers: {
          Accept: 'application/json',
          'x-pay-token': this.accessToken,
          'network-id': 19077,
        },
      });
    } catch (e) {
      throw e;
    }
  }

  private async getAccessToken(): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const qs = require('qs');

    const data = qs.stringify({
      grant_type: 'password',
      client_id: 'wsapi',
      client_secret: Config.bank.olkyPay.clientSecret,
      username: Config.bank.olkyPay.username,
      password: Config.bank.olkyPay.password,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    });

    const key = await this.http.request<any>({
      url: `${this.loginUrl}`,
      method: 'POST',
      data: data,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return key.access_token;
  }
}
