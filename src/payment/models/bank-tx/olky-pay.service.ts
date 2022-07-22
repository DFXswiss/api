import { Injectable, ServiceUnavailableException } from '@nestjs/common';
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

enum TransactionType {
  RECEIVED = 'SCT_RECEIVED',
  SENT = 'SCT_SENT',
  BILLING = 'BILLING',
}

@Injectable()
export class OlkyPayService {
  private readonly baseUrl = 'https://ws.olkypay.com/reporting/';
  private readonly loginUrl = 'https://ws.olkypay.com/reporting/ecritures/';
  private xPayToken = 'x-pay-token-will-be-updated';

  constructor(private readonly http: HttpService) {}

  async getAllTransaction(fromDate: Date, toDate: Date): Promise<Transaction> {
    const url = `${this.baseUrl}/ecritures/${Config.bank.olkyPay.clientId}/${fromDate.toISOString().split('T')[0]}/${
      toDate.toISOString().split('T')[0]
    }`;

    try {
      const result = this.callApi<Transaction>('customers/simple', 'POST');

      return result;
    } catch (error) {
      throw new ServiceUnavailableException(`Failed to get Transactions from :`, error);
    }
  }

  private async callApi<T>(url: string, method: Method = 'GET', data?: any, contentType?: any): Promise<T> {
    return this.request<T>(url, method, data, contentType).catch((e: HttpError) => {
      if (e.response?.status === 404) {
        return null;
      }

      throw new ServiceUnavailableException(e);
    });
  }

  private async request<T>(url: string, method: Method, data?: any, getNewKey = false): Promise<T> {
    try {
      if (getNewKey) this.xPayToken = await this.getNewSessionKey();
      return await this.http.request<T>({
        url: `${this.baseUrl}/${url}`,
        method: method,
        data: data,
        headers: {
          Accept: 'application/json',
          'x-pay-token': this.xPayToken,
          'network-id': 19077,
        },
      });
    } catch (e) {
      throw e;
    }
  }

  private async getNewSessionKey(): Promise<string> {
    // get the challenge
    const key = '';
    return key;
  }
}
