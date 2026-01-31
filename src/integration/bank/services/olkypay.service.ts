import { Injectable } from '@nestjs/common';
import { Method } from 'axios';
import { stringify } from 'qs';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { BankTx, BankTxIndicator, BankTxType } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import {
  OlkypayBalance,
  OlkypayBankAccountRequest,
  OlkypayEntityResponse,
  OlkypayOrderResponse,
  OlkypayPayerRequest,
  OlkypayPaymentOrderRequest,
  OlkypayTokenAuth,
  OlkypayTransaction,
  OlkypayTransactionType,
} from '../dto/olkypay.dto';
import { OlkyRecipient } from '../entities/olky-recipient.entity';
import { OlkyRecipientRepository } from '../repositories/olky-recipient.repository';

export interface OlkyRecipientData {
  iban: string;
  name: string;
  address?: string;
  zip?: string;
  city?: string;
  country?: string;
}

@Injectable()
export class OlkypayService {
  private readonly logger = new DfxLogger(OlkypayService);

  private readonly baseUrl = 'https://ws.olkypay.com';
  private readonly loginUrl = 'https://stp.olkypay.com/auth/realms/b2b/protocol/openid-connect/token';

  private accessToken = 'access-token-will-be-updated';
  private cachedSupplierId: number;

  constructor(
    private readonly http: HttpService,
    private readonly olkyRecipientRepo: OlkyRecipientRepository,
  ) {}

  isAvailable(): boolean {
    return !!Config.bank.olkypay.credentials.clientId;
  }

  // --- TRANSACTION METHODS --- //

  async getOlkyTransactions(lastModificationTime: string, accountIban: string): Promise<Partial<BankTx>[]> {
    if (!Config.bank.olkypay.credentials.clientId) return [];

    try {
      const transactions = await this.getTransactions(new Date(lastModificationTime), Util.daysAfter(7));
      if (!transactions) return [];

      return transactions.map((t) => this.parseTransaction(t, accountIban));
    } catch (e) {
      this.logger.error(`Failed to get Bank Olky transactions:`, e);
      return [];
    }
  }

  private async getTransactions(fromDate: Date, toDate: Date = new Date()): Promise<OlkypayTransaction[]> {
    const url = `reporting/ecritures/${Config.bank.olkypay.credentials.clientId}/${Util.isoDate(fromDate)}/${Util.isoDate(
      toDate,
    )}`;

    return this.callApi<OlkypayTransaction[]>(url);

    // --- BALANCE METHODS --- //
  }

  async getBalance(): Promise<{ balance: number; balanceOperationYesterday: number }> {
    const balance = await this.getBalanceRaw();
    return {
      balance: Util.round(balance.balance / 100, 2),
      balanceOperationYesterday: Util.round(balance.balanceOperationYesterday / 100, 2),
    };
  }

  private async getBalanceRaw(): Promise<OlkypayBalance> {
    const url = `reporting/balance/today/${Config.bank.olkypay.credentials.clientId}`;
    return this.callApi<OlkypayBalance>(url);
  }

  private async getSupplierId(): Promise<number> {
    if (!this.cachedSupplierId) {
      const balance = await this.getBalanceRaw();
      this.cachedSupplierId = balance.supplierId;
    }
    return this.cachedSupplierId;
  }

  // --- RECIPIENT METHODS --- //

  async getOrCreateRecipient(data: OlkyRecipientData): Promise<OlkyRecipient> {
    const account =
      (await this.olkyRecipientRepo.findOneBy({
        iban: data.iban,
        name: data.name,
        address: data.address ?? null,
        zip: data.zip ?? null,
        city: data.city ?? null,
        country: data.country ?? null,
      })) ?? (await this.createRecipient(data));

    if (account.olkyPayerId && account.olkyBankAccountId) return account;

    return this.registerAtOlkypay(account);
  }

  private async createRecipient(data: OlkyRecipientData): Promise<OlkyRecipient> {
    const account = this.olkyRecipientRepo.create({
      iban: data.iban,
      name: data.name,
      address: data.address,
      zip: data.zip,
      city: data.city,
      country: data.country,
    });

    return this.olkyRecipientRepo.save(account);
  }

  private async registerAtOlkypay(account: OlkyRecipient): Promise<OlkyRecipient> {
    // Create payer if not exists
    if (!account.olkyPayerId) {
      const payerResponse = await this.createPayer({
        externalClientCode: `OR-${account.id}`,
        fullName: account.name,
        moralPerson: true,
        zipCode: account.zip,
        city: account.city,
        supplierId: await this.getSupplierId(),
        countryCode: account.country,
        address1: account.address,
        beneficiary: true,
      });

      account.olkyPayerId = payerResponse.id;
      await this.olkyRecipientRepo.update(account.id, { olkyPayerId: payerResponse.id });
    }

    // Create bank account if not exists
    if (!account.olkyBankAccountId) {
      const bankAccountResponse = await this.createBankAccount({
        clientId: +account.olkyPayerId,
        name: account.name,
        iban: account.iban,
      });

      account.olkyBankAccountId = bankAccountResponse.id;
      await this.olkyRecipientRepo.update(account.id, { olkyBankAccountId: bankAccountResponse.id });
    }

    return account;
  }

  private async createPayer(payer: OlkypayPayerRequest): Promise<OlkypayEntityResponse> {
    return this.callApi<OlkypayEntityResponse>('payer', 'POST', payer);
  }

  private async createBankAccount(bankAccount: OlkypayBankAccountRequest): Promise<OlkypayEntityResponse> {
    return this.callApi<OlkypayEntityResponse>('bankaccount', 'POST', bankAccount);
  }

  // --- PAYMENT ORDER METHODS --- //

  async createPaymentOrder(order: OlkypayPaymentOrderRequest): Promise<OlkypayEntityResponse> {
    return this.callApi<OlkypayEntityResponse>('order/vir', 'POST', order);
  }

  async getPaymentOrder(orderId: number): Promise<OlkypayOrderResponse> {
    return this.callApi<OlkypayOrderResponse>(`order/${orderId}`, 'GET');
  }

  // --- PARSING --- //
  private parseTransaction(tx: OlkypayTransaction, accountIban: string): Partial<BankTx> {
    if (tx.debit > 0 && tx.credit > 0)
      throw new Error(`Transaction ${tx.idCtp} with debit (${tx.debit} EUR) and credit (${tx.credit} EUR)`);

    try {
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
        accountIban: accountIban,
        type: tx.codeInterbancaireInterne === OlkypayTransactionType.BILLING ? BankTxType.BANK_ACCOUNT_FEE : null,
        bankReleaseDate: new Date(),
      };
    } catch (e) {
      throw new Error(`Failed to parse transaction ${tx.idCtp}: ${e.message}`);
    }
  }

  private parseDate(olkypayDate: number[]): Date {
    return new Date(olkypayDate[0], olkypayDate[1] - 1, olkypayDate[2]);
  }

  private getNameAndAddress(tx: OlkypayTransaction): { name?: string; addressLine1?: string } {
    switch (tx.codeInterbancaireInterne) {
      case OlkypayTransactionType.SENT:
        return {
          name: tx.line1.split('Virement Inst Client : ')[1] ?? tx.line1.split('Virement SEPA Client : ')[1],
        };
      case OlkypayTransactionType.RECEIVED:
        return {
          name: tx.line1.split(' Recu ')[1]?.split(' [ Adresse débiteur : ')[0],
          addressLine1: tx.line1.split(' [ Adresse débiteur : ')[1]?.replace(/[[\]]/g, '').trim(),
        };
    }

    return {};
  }

  // --- HELPER METHODS --- //
  private async callApi<T>(
    url: string,
    method: Method = 'GET',
    data?: any,
    nthTry = 3,
    getNewAccessToken = false,
  ): Promise<T> {
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
          'Content-Type': 'application/json',
          'x-pay-token': this.accessToken,
          'network-id': 19077,
        },
      });
    } catch (e) {
      if (nthTry > 1 && e.response?.status === 403) {
        return this.callApi(url, method, data, nthTry - 1, true);
      }
      throw e;
    }
  }

  private async getTokenAuth(): Promise<OlkypayTokenAuth> {
    const data = stringify({
      grant_type: 'password',
      client_id: 'wsapi',
      client_secret: Config.bank.olkypay.credentials.clientSecret,
      username: Config.bank.olkypay.credentials.username,
      password: Config.bank.olkypay.credentials.password,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    });

    return this.http.request<OlkypayTokenAuth>({
      url: `${this.loginUrl}`,
      method: 'POST',
      data: data,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }
}
