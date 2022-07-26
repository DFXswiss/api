import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Method } from 'axios';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { HttpError, HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/util';
import { BankTxBatch } from './bank-tx-batch.entity';
import { BankTx, BankTxIndicator, BankTxType } from './bank-tx.entity';
import { BankTxService } from './bank-tx.service';

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

  constructor(
    private readonly http: HttpService,
    private readonly bankTxService: BankTxService,
    private readonly settingService: SettingService,
  ) {}

  // --- TRANSACTION HANDLING --- //
  @Interval(60000)
  async checkInputs(): Promise<void> {
    const settingKey = 'lastOlkyPayDate';
    const lastModificationTime = await this.settingService.get(settingKey);
    const newModificationTime = new Date().toISOString().split('T')[0];

    const allTransaction = await this.getTransactions(lastModificationTime);

    for (const transaction of allTransaction) {
      try {
        const bankTx = this.parseTransaction(transaction);
        await this.bankTxService.create(bankTx);
      } catch (e) {
        console.error(`Failed to import Transaction:`, e);
      }
    }

    await this.settingService.set(settingKey, newModificationTime);
  }

  private async getTransactions(fromDate: string): Promise<Transaction[]> {
    const url = `ecritures/${Config.bank.olkyPay.clientId}/${fromDate}/${new Date().toISOString().split('T')[0]}`;

    try {
      return await this.callApi<Transaction[]>(url);
    } catch (error) {
      throw new ServiceUnavailableException(`Failed to get Transactions:`, error);
    }
  }

  private async getBalance(): Promise<Balance> {
    const url = `balance/today/${Config.bank.olkyPay.clientId}`;

    try {
      return await this.callApi<Balance>(url);
    } catch (error) {
      throw new ServiceUnavailableException(`Failed to get Balance:`, error);
    }
  }

  // --- PARSING --- //
  private parseTransaction(tx: Transaction): Partial<BankTx> {
    if (tx.debit > 0 && tx.credit > 0)
      throw new Error(`Transaction with debit (${tx.debit} EUR) and credit (${tx.credit} EUR)`);

    return {
      accountServiceRef: tx.idCtp.toString(),
      bookingDate: this.parseDate(tx.dateEcriture),
      valueDate: this.parseDate(tx.dateValeur),
      txCount: 1,
      instructionId: tx.codeInterbancaireInterne,
      amount: Util.round((tx.debit + tx.credit) / 100, 2),
      currency: 'EUR',
      creditDebitIndicator: tx.debit > 0 ? BankTxIndicator.DEBIT : BankTxIndicator.CREDIT,
      iban: tx.instructingIban,
      ...this.getNameAndAddress(tx),
      txInfo: tx.line1,
      remittanceInfo: tx.line2,
      type: tx.codeInterbancaireInterne === TransactionType.BILLING ? BankTxType.INTERNAL : null,
      batch: { id: 1 } as BankTxBatch, // TODO create an olky pay batch and replace the ID
    };
  }

  private parseDate(olkyDate: number[]): Date {
    return new Date(olkyDate[0], olkyDate[1], olkyDate[2]);
  }

  private getNameAndAddress(tx: Transaction): { name?: string; addressLine1?: string } {
    switch (tx.codeInterbancaireInterne) {
      case TransactionType.SENT:
        return {
          name: tx.line1.split('Virement Inst Client : ')[1],
        };
      case TransactionType.RECEIVED:
        return {
          name: tx.line1.split(' Recu ')[1]?.split(' [ Adresse débiteur : ')[0],
          addressLine1: tx.line1.split(' [ Adresse débiteur : ')[1]?.replace(']', ''),
        };
    }

    return {};
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
      if (nthTry > 1) {
        return this.request(url, method, data, nthTry - 1, true);
      }
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
