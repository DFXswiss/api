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
        this.parseTransaction(transaction).then((transaction) => this.bankTxService.create(transaction));
      } catch (e) {
        console.error(`Failed to import Transaction:`, e);
      }
    }

    await this.settingService.set(settingKey, newModificationTime);
  }

  async parseTransaction(transaction: Transaction): Promise<Partial<BankTx>> {
    let amount;
    let addressLine1;
    let name = transaction.line1;
    let txInfo = transaction.line1;
    let type;
    if (transaction.debit > 0) {
      amount = transaction.debit;
      if (transaction.codeInterbancaireInterne == TransactionType.SENT)
        name = transaction.line1.split('Virement Inst Client : ')[1];
      if (transaction.codeInterbancaireInterne == TransactionType.BILLING) {
        type = BankTxType.INTERNAL;
        txInfo = txInfo + ' ' + name;
      }
    } else {
      amount = transaction.credit;
      type = BankTxType.BUY_CRYPTO;
      if (transaction.codeInterbancaireInterne == TransactionType.RECEIVED) {
        name = name.split(' Recu ')[1];
        if (name.includes('Adresse débiteur')) {
          addressLine1 = name.split(' [ Adresse débiteur : ')[1].replace(']', '');
          name = name.split(' [ Adresse débiteur : ')[0];
        }
      }
    }

    return {
      accountServiceRef: transaction.idCtp.toString(),
      bookingDate: new Date(transaction.dateEcriture[0], transaction.dateEcriture[1], transaction.dateEcriture[2]),
      valueDate: new Date(transaction.dateValeur[0], transaction.dateValeur[1], transaction.dateValeur[2]),
      txCount: 1,
      instructionId: transaction.codeInterbancaireInterne,
      amount: Util.round(amount / 100, 2),
      iban: transaction.instructingIban,
      batch: { id: 1 } as BankTxBatch, //TODO create an olky pay batch and replace the ID
      currency: 'EUR',
      creditDebitIndicator: transaction.debit > 0 ? BankTxIndicator.DEBIT : BankTxIndicator.CREDIT,
      remittanceInfo: transaction.line2,
      name,
      addressLine1,
      txInfo: txInfo,
      type,
    };
  }

  async getTransactions(fromDate: string): Promise<Transaction[]> {
    const url = `ecritures/${Config.bank.olkyPay.clientId}/${fromDate}/${new Date().toISOString().split('T')[0]}`;

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
