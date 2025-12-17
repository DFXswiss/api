import { Injectable } from '@nestjs/common';
import { Method } from 'axios';
import * as https from 'https';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import {
  VibanListResponse,
  VibanProposalResponse,
  VibanReserveRequest,
  VibanReserveResponse,
  YapealAccount,
  YapealAccountsResponse,
  YapealAccountStatus,
  YapealEntitledAccount,
  YapealPaymentStatusResponse,
  YapealSubscription,
  YapealSubscriptionFormat,
  YapealSubscriptionRequest,
} from '../dto/yapeal.dto';
import { CamtTransaction, Iso20022Service, Pain001Payment } from './iso20022.service';

export interface YapealBalanceInfo {
  iban: string;
  currency: string;
  availableBalance: number;
  totalBalance: number;
}

@Injectable()
export class YapealService {
  constructor(private readonly http: HttpService) {}

  isAvailable(): boolean {
    const { baseUrl, apiKey, partnershipUid } = Config.bank.yapeal;
    return !!(baseUrl && apiKey && partnershipUid);
  }

  // --- VIBAN METHODS --- //

  async createViban(baseAccountIban: string): Promise<VibanReserveResponse> {
    const proposal = await this.getVibanProposal();
    return this.reserveViban(proposal.bban, baseAccountIban);
  }

  async listVibans(accountUid: string, count = 100, offset = 0): Promise<VibanListResponse> {
    return this.callApi<VibanListResponse>(
      `b2b/v2/cash-accounts/${accountUid}/vibans?count=${count}&offset=${offset}`,
      'GET',
    );
  }

  private async getVibanProposal(): Promise<VibanProposalResponse> {
    const { partnershipUid } = Config.bank.yapeal;
    return this.callApi<VibanProposalResponse>(`b2b/v2/partnerships/${partnershipUid}/viban/proposal`, 'GET');
  }

  private async reserveViban(bban: string, baseAccountIban: string): Promise<VibanReserveResponse> {
    const { partnershipUid } = Config.bank.yapeal;

    const request: VibanReserveRequest = {
      baseAccountIBAN: baseAccountIban,
      bban,
    };

    return this.callApi<VibanReserveResponse>(
      `b2b/v2/partnerships/${partnershipUid}/cash-accounts/viban/reserve`,
      'POST',
      request,
    );
  }

  // --- ACCOUNT/BALANCE METHODS --- //

  async getBalances(): Promise<YapealBalanceInfo[]> {
    const response = await this.getAccounts();

    return response.map((a) => ({
      iban: a.iban,
      currency: a.currency,
      availableBalance: this.convertYapealAmount(a.balances.available.amount),
      totalBalance: this.convertYapealAmount(a.balances.total.amount),
    }));
  }

  async getEntitledAccounts(): Promise<YapealEntitledAccount[]> {
    const { partnershipUid, adminUid } = Config.bank.yapeal;
    return this.callApi<YapealEntitledAccount[]>(
      `b2b/v2/agent/${partnershipUid}/accounts/entitled?executingAgentUID=${adminUid}`,
      'GET',
    );
  }

  private async getAccounts(): Promise<YapealAccount[]> {
    const { partnershipUid, accountIdentifier } = Config.bank.yapeal;

    return this.callApi<YapealAccountsResponse>(`b2b/v2/agent/${partnershipUid}/accounts`, 'GET').then((r) =>
      r.accounts.filter(
        (account) => account.status === YapealAccountStatus.ACTIVE && account.iban.includes(accountIdentifier),
      ),
    );
  }

  // --- TRANSACTION METHODS --- //

  async getTransactions(accountIban: string, fromDate: Date, toDate: Date): Promise<CamtTransaction[]> {
    const statement = await this.getAccountStatement(accountIban, fromDate, toDate);
    return Iso20022Service.parseCamt053Xml(statement, accountIban);
  }

  private async getAccountStatement(iban: string, fromDate: Date, toDate: Date): Promise<string> {
    const params = new URLSearchParams({
      fromDate: Util.isoDate(fromDate),
      toDate: Util.isoDate(toDate),
    });

    return this.callApi<string>(`b2b/accounts/${iban}/camt-053-statement?${params.toString()}`, 'GET', undefined, true);
  }

  async sendPayment(payment: Pain001Payment): Promise<void> {
    const request = Iso20022Service.createPain001Json(payment);

    await this.callApi<unknown>('b2b/instant-payment-orders/by-pain', 'POST', request, true);
  }

  async getPaymentStatus(msgId: string): Promise<YapealPaymentStatusResponse> {
    return this.callApi<YapealPaymentStatusResponse>(`b2b/instant-payment-order/${msgId}/state`, 'GET');
  }

  // --- SUBSCRIPTION METHODS --- //

  async createTransactionSubscription(
    iban: string,
    callbackPath?: string,
    format: YapealSubscriptionFormat = YapealSubscriptionFormat.JSON,
  ): Promise<YapealSubscription> {
    const request: YapealSubscriptionRequest = {
      iban,
      format,
    };
    if (callbackPath) request.callbackPath = callbackPath;

    return this.callApi<YapealSubscription>('b2b/v2/account/subscribe', 'POST', request, true);
  }

  async getTransactionSubscriptions(): Promise<YapealSubscription[]> {
    return this.callApi<YapealSubscription[]>('b2b/v2/accounts/subscription', 'GET', undefined, true);
  }

  async deleteTransactionSubscription(iban: string): Promise<void> {
    await this.callApi<void>(`b2b/v2/account/subscription?iban=${iban}`, 'DELETE', undefined, true);
  }

  // --- HELPER METHODS --- //

  private convertYapealAmount(amount: { factor: number; value: number }): number {
    // YAPEAL returns amount as value * 10^(-factor)
    // e.g., { value: 12345, factor: 2 } = 123.45
    return amount.value / Math.pow(10, amount.factor);
  }

  private async callApi<T>(
    url: string,
    method: Method = 'GET',
    data?: unknown,
    includePartnerHeaders = false,
  ): Promise<T> {
    if (!this.isAvailable()) throw new Error('YAPEAL is not configured');

    const { baseUrl, apiKey, adminUid, partnershipUid, cert, key, rootCa } = Config.bank.yapeal;

    try {
      return await this.http.request<T>({
        url: `${baseUrl}/${url}`,
        method,
        data,
        httpsAgent: new https.Agent({
          cert,
          key,
          ...(rootCa && { ca: rootCa }),
        }),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          ...(includePartnerHeaders && {
            'x-partnership-uid': partnershipUid,
            'x-partner-uid': adminUid,
          }),
        },
      });
    } catch (error) {
      const message = error?.response?.data ? JSON.stringify(error.response.data) : error?.message || error;

      throw new Error(`YAPEAL API error (${method} ${url}): ${message}`);
    }
  }
}
