import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Method } from 'axios';
import { Config } from 'src/config/config';
import { HttpError, HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { BankTx, BankTxIndicator, BankTxType } from './bank-tx.entity';
import { stringify } from 'qs';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { Bank, BankName } from 'src/subdomains/supporting/bank/bank/bank.entity';

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

  constructor(private readonly http: HttpService, private readonly bankService: BankService) {}

  async getOlkyTransactions(lastModificationTime: string): Promise<Partial<BankTx>[]> {
    if (!Config.bank.olkypay.credentials.clientId) return [];

    let transactions: Transaction[];
    try {
      transactions = await this.getTransactions(new Date(lastModificationTime), Util.daysAfter(1));
      if (!transactions) return [];

      const bank = await this.bankService.getBankInternal(BankName.OLKY, 'EUR');

      return transactions.map((t) => this.parseTransaction(t, bank));
    } catch (e) {
      console.error('Failed to get Bank Olky transactions:', e, transactions);
      return [];
    }
  }

  private async getTransactions(fromDate: Date, toDate: Date = new Date()): Promise<Transaction[]> {
    const url = `ecritures/${Config.bank.olkypay.credentials.clientId}/${Util.isoDate(fromDate)}/${Util.isoDate(
      toDate,
    )}`;

    return this.callApi<Transaction[]>(url);
  }

  async getBalance(): Promise<Balance> {
    const url = `balance/today/${Config.bank.olkypay.credentials.clientId}`;
    const balance = await this.callApi<Balance>(url);
    return {
      balance: Util.round(balance.balance / 100, 2),
      balanceOperationYesterday: Util.round(balance.balanceOperationYesterday / 100, 2),
    };
  }

  // --- PARSING --- //
  private parseTransaction(tx: Transaction, bank: Bank): Partial<BankTx> {
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
      txAmount: amount,
      chargeAmount: 0,
      currency,
      instructedCurrency: currency,
      txCurrency: currency,
      chargeCurrency: currency,
      creditDebitIndicator: tx.debit > 0 ? BankTxIndicator.DEBIT : BankTxIndicator.CREDIT,
      iban: tx.instructingIban,
      ...this.getNameAndAddress(tx),
      txInfo: tx.line1,
      txRaw: JSON.stringify(tx),
      remittanceInfo: tx.line2,
      accountIban: bank.iban,
      type: tx.codeInterbancaireInterne === TransactionType.BILLING ? BankTxType.INTERNAL : null,
    };
  }

  private parseDate(olkypayDate: number[]): Date {
    return new Date(olkypayDate[0], olkypayDate[1] - 1, olkypayDate[2]);
  }

  private getNameAndAddress(tx: Transaction): { name?: string; addressLine1?: string } {
    switch (tx.codeInterbancaireInterne) {
      case TransactionType.SENT:
        return {
          name: tx.line1.split('Virement Inst Client : ')[1] ?? tx.line1.split('Virement SEPA Client : ')[1],
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
      client_secret: Config.bank.olkypay.credentials.clientSecret,
      username: Config.bank.olkypay.credentials.username,
      password: Config.bank.olkypay.credentials.password,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    });

    return this.http.request<TokenAuth>({
      url: `${this.loginUrl}`,
      method: 'POST',
      data: data,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }
}
