import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Method } from 'axios';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { HttpError, HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/util';
import { BankTxBatch } from './bank-tx-batch.entity';
import { BankTx, BankTxIndicator, BankTxType } from './bank-tx.entity';
import { BankTxService } from './bank-tx.service';
import { stringify } from 'qs';
import { BankTxBatchRepository } from './bank-tx-batch.repository';

interface Transaction {
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

interface Balance {
  balance: number;
  balanceOperationYesterday: number;
}

interface TokenAuth {
  access_token: string;
  expires_in: number;
  refresh_expires_in: number;
  refresh_token: string;
  token_type: string;
  id_token: string;
  session_state: string;
}

enum TransactionType {
  RECEIVED = 'SCT_RECEIVED',
  SENT = 'SCT_SENT',
  BILLING = 'BILLING',
}

@Injectable()
export class OlkypayService {
  private readonly baseUrl = 'https://ws.olkypay.com/reporting';
  private readonly loginUrl = 'https://stp.olkypay.com/auth/realms/b2b/protocol/openid-connect/token';
  private accessToken = 'access-token-will-be-updated';
  private bankTxBatch: BankTxBatch;

  constructor(
    private readonly http: HttpService,
    private readonly bankTxService: BankTxService,
    private readonly bankTxBatchService: BankTxBatchRepository,
    private readonly settingService: SettingService,
  ) {}

  // --- TRANSACTION HANDLING --- //
  @Interval(60000)
  async checkTransactions(): Promise<void> {
    try {
      if (!Config.bank.olkypay.clientId) return;
      const settingKey = 'lastOlkypayDate';
      const lastModificationTime = await this.settingService.get(settingKey, new Date(0).toISOString());

      const newModificationTime = new Date().toISOString();
      this.bankTxBatch = await this.bankTxBatchService.findOne({ where: { iban: Config.bank.olkypay.iban } });

      const transactions = await this.getTransactions(new Date(lastModificationTime));

      for (const transaction of transactions) {
        try {
          const bankTx = this.parseTransaction(transaction);
          await this.bankTxService.create(bankTx);
        } catch (e) {
          if (!(e instanceof ConflictException)) console.error(`Failed to import transaction:`, e);
        }
      }

      await this.settingService.set(settingKey, newModificationTime);
    } catch (e) {
      console.error(`Failed to check olkypay transactions:`, e);
    }
  }

  private async getTransactions(fromDate: Date, toDate: Date = new Date()): Promise<Transaction[]> {
    const url = `ecritures/${Config.bank.olkypay.clientId}/${Util.isoDate(fromDate)}/${Util.isoDate(toDate)}`;

    return await this.callApi<Transaction[]>(url);
  }

  private async getBalance(): Promise<Balance> {
    const url = `balance/today/${Config.bank.olkypay.clientId}`;

    return await this.callApi<Balance>(url);
  }

  // --- PARSING --- //
  private parseTransaction(tx: Transaction): Partial<BankTx> {
    if (tx.debit > 0 && tx.credit > 0)
      throw new Error(`Transaction with debit (${tx.debit} EUR) and credit (${tx.credit} EUR)`);

    const amount = Util.round((tx.debit + tx.credit) / 100, 2);
    const currency = 'EUR';
    return {
      accountServiceRef: tx.idCtp.toString(),
      bookingDate: this.parseDate(tx.dateEcriture),
      valueDate: this.parseDate(tx.dateValeur),
      txCount: 1,
      instructionId: tx.codeInterbancaireInterne,
      amount,
      instructedAmount: amount,
      instructedCurrency: currency,
      currency,
      txAmount: amount,
      chargeAmount: 0,
      chargeCurrency: currency,
      creditDebitIndicator: tx.debit > 0 ? BankTxIndicator.DEBIT : BankTxIndicator.CREDIT,
      iban: tx.instructingIban,
      ...this.getNameAndAddress(tx),
      txInfo: tx.line1,
      remittanceInfo: tx.line2,
      type: tx.codeInterbancaireInterne === TransactionType.BILLING ? BankTxType.INTERNAL : null,
      batch: this.bankTxBatch,
    };
  }

  private parseDate(olkypayDate: number[]): Date {
    return new Date(olkypayDate[0], olkypayDate[1], olkypayDate[2]);
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
      if (getNewAccessToken) {
        const tokenAuth = await this.getTokenAuth();
        this.accessToken = tokenAuth.access_token;
      }
      return await this.http.request<T>({
        url: `${this.baseUrl}/${url}`,
        method: method,
        data: data,
        headers: {
          Accept: 'application/json',
          'x-pay-token': this.accessToken,
          'network-id': 19077,
        },
      });
    } catch (e) {
      if (nthTry > 1 && e.response.status == 403) {
        return this.request(url, method, data, nthTry - 1, true);
      }
      throw e;
    }
  }

  private async getTokenAuth(): Promise<TokenAuth> {
    const data = stringify({
      grant_type: 'password',
      client_id: 'wsapi',
      client_secret: Config.bank.olkypay.clientSecret,
      username: Config.bank.olkypay.username,
      password: Config.bank.olkypay.password,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    });

    return await this.http.request<TokenAuth>({
      url: `${this.loginUrl}`,
      method: 'POST',
      data: data,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }
}
