import { Injectable } from '@nestjs/common';
import { Method } from 'axios';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import {
  VibanListResponse,
  VibanProposalResponse,
  VibanReserveRequest,
  VibanReserveResponse,
  YapealAccountsResponse,
  YapealAccountStatus,
  YapealPaymentStatus,
  YapealPaymentStatusResponse,
  YapealSubscription,
  YapealSubscriptionFormat,
  YapealSubscriptionRequest,
  YapealSubscriptionsResponse,
} from '../dto/yapeal.dto';
import { Iso20022Service, Pain001Payment } from './iso20022.service';

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

  async createViban(): Promise<VibanReserveResponse> {
    const proposal = await this.getVibanProposal();
    return this.reserveViban(proposal.bban);
  }

  async listVibans(accountUid: string): Promise<VibanListResponse> {
    return this.callApi<VibanListResponse>(`b2b/v2/cash-accounts/${accountUid}/vibans`, 'GET');
  }

  private async getVibanProposal(): Promise<VibanProposalResponse> {
    const { partnershipUid, partnerUid } = Config.bank.yapeal;
    return this.callApi<VibanProposalResponse>(
      `b2b/v2/partnerships/${partnershipUid}/viban/proposal?executingAgentUID=${partnerUid}`,
      'GET',
    );
  }

  private async reserveViban(bban: string): Promise<VibanReserveResponse> {
    const { partnershipUid, baseAccountIban } = Config.bank.yapeal;

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

    return response.accounts
      .filter((account) => account.status === YapealAccountStatus.ACTIVE)
      .map((account) => ({
        iban: account.iban,
        currency: account.currency,
        availableBalance: this.convertYapealAmount(account.balances.available.amount),
        totalBalance: this.convertYapealAmount(account.balances.total.amount),
      }));
  }

  private async getAccounts(): Promise<YapealAccountsResponse> {
    const { partnershipUid } = Config.bank.yapeal;
    return this.callApi<YapealAccountsResponse>(`b2b/v2/agent/${partnershipUid}/accounts`, 'GET');
  }

  // --- PAYMENT METHODS --- //

  async sendPayment(payment: Pain001Payment): Promise<{ msgId: string; status: YapealPaymentStatus }> {
    const request = Iso20022Service.createPain001Json(payment);

    await this.callApi<unknown>('b2b/instant-payment-orders/by-pain', 'POST', request, 'payment');

    const { status } = await this.getPaymentStatus(payment.messageId);

    return { msgId: payment.messageId, status };
  }

  async getPaymentStatus(msgId: string): Promise<YapealPaymentStatusResponse> {
    return this.callApi<YapealPaymentStatusResponse>(`b2b/instant-payment-order/${msgId}/state`, 'GET');
  }

  // --- TRANSACTION SUBSCRIPTION METHODS --- //

  async createTransactionSubscription(
    iban: string,
    callbackUrl?: string,
    format: YapealSubscriptionFormat = YapealSubscriptionFormat.JSON,
  ): Promise<YapealSubscription> {
    const request: YapealSubscriptionRequest = {
      iban,
      callbackPath: callbackUrl,
      format,
    };

    return this.callApi<YapealSubscription>('b2b/v2/account/subscribe', 'POST', request, 'subscription');
  }

  async getTransactionSubscriptions(): Promise<YapealSubscriptionsResponse> {
    return this.callApi<YapealSubscriptionsResponse>('b2b/v2/accounts/subscription', 'GET', undefined, 'subscription');
  }

  async deleteTransactionSubscription(iban: string): Promise<void> {
    await this.callApi<void>(`b2b/v2/account/subscription?iban=${iban}`, 'DELETE', undefined, 'subscription');
  }

  // Subscribe to base account - receives notifications for all associated vIBANs
  async subscribeToBaseAccountTransactions(callbackUrl: string): Promise<YapealSubscription> {
    const { baseAccountIban } = Config.bank.yapeal;
    return this.createTransactionSubscription(baseAccountIban, callbackUrl);
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
    headerType?: 'payment' | 'subscription',
  ): Promise<T> {
    if (!this.isAvailable()) throw new Error('YAPEAL is not configured');

    const { baseUrl, apiKey, partnershipUid, partnerUid } = Config.bank.yapeal;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    if (headerType === 'payment') {
      headers['x-partnership-uid'] = partnershipUid;
      headers['x-partner-uid'] = partnerUid;
    } else if (headerType === 'subscription') {
      headers['x-partnership-uid'] = partnershipUid;
    }

    return this.http.request<T>({
      url: `${baseUrl}/${url}`,
      method,
      data,
      headers,
    });
  }
}
