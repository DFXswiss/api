import { Injectable } from '@nestjs/common';
import { Method } from 'axios';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { Pain001Payment } from './iso20022.service';
import {
  VibanListResponse,
  VibanProposalResponse,
  VibanReserveRequest,
  VibanReserveResponse,
  YapealAccountsResponse,
  YapealPain001Request,
  YapealPaymentStatus,
  YapealPaymentStatusResponse,
} from '../dto/yapeal.dto';

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

  // --- ACCOUNT/BALANCE METHODS --- //

  async getAccounts(): Promise<YapealAccountsResponse> {
    const { partnershipUid } = Config.bank.yapeal;
    return this.callApi<YapealAccountsResponse>(`b2b/v2/agent/${partnershipUid}/accounts`, 'GET');
  }

  async getBalance(iban?: string): Promise<YapealBalanceInfo | undefined> {
    const response = await this.getAccounts();
    const targetIban = iban ?? Config.bank.yapeal.baseAccountIban;

    const account = response.accounts.find((a) => a.iban === targetIban && a.status === 'active');
    if (!account) return undefined;

    return {
      iban: account.iban,
      currency: account.currency,
      availableBalance: this.convertYapealAmount(account.balances.available.amount),
      totalBalance: this.convertYapealAmount(account.balances.total.amount),
    };
  }

  // --- PAYMENT METHODS --- //

  async sendPayment(payment: Pain001Payment): Promise<{ msgId: string; status: YapealPaymentStatus }> {
    const msgId = Util.createUniqueId('MSG');
    const request = this.buildPain001Request(payment, msgId);

    await this.callApi<unknown>('b2b/instant-payment-orders/by-pain', 'POST', request, true);

    const { status } = await this.getPaymentStatus(msgId);

    return { msgId, status };
  }

  async getPaymentStatus(msgId: string): Promise<YapealPaymentStatusResponse> {
    return this.callApi<YapealPaymentStatusResponse>(`b2b/instant-payment-order/${msgId}/state`, 'GET');
  }

  // --- HELPER METHODS --- //

  private async getVibanProposal(): Promise<VibanProposalResponse> {
    const { partnershipUid } = Config.bank.yapeal;
    return this.callApi<VibanProposalResponse>(`b2b/v2/partnerships/${partnershipUid}/viban/proposal`, 'GET');
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

  private buildPain001Request(payment: Pain001Payment, msgId: string): YapealPain001Request {
    const endToEndId = payment.endToEndId || Util.createUniqueId('E2E');

    return {
      CstmrCdtTrfInitn: {
        GrpHdr: {
          MsgId: msgId,
          NbOfTxs: '1',
          CtrlSum: payment.amount,
          InitgPty: {
            Nm: payment.debtor.name,
          },
        },
        PmtInf: [
          {
            Dbtr: {
              Nm: payment.debtor.name,
              PstlAdr: {
                Ctry: payment.debtor.country,
              },
            },
            DbtrAcct: {
              Id: {
                IBAN: payment.debtor.iban,
              },
              Ccy: payment.currency,
            },
            CdtTrfTxInf: [
              {
                PmtId: {
                  EndToEndId: endToEndId,
                },
                Amt: {
                  InstdAmt: {
                    Ccy: payment.currency,
                    value: payment.amount,
                  },
                },
                Cdtr: {
                  Nm: payment.creditor.name,
                  PstlAdr: {
                    Ctry: payment.creditor.country,
                  },
                },
                CdtrAcct: {
                  Id: {
                    IBAN: payment.creditor.iban,
                  },
                },
                ...(payment.remittanceInfo && {
                  RmtInf: {
                    Ustrd: payment.remittanceInfo,
                  },
                }),
              },
            ],
          },
        ],
      },
    };
  }

  private convertYapealAmount(amount: { factor: number; value: number }): number {
    // YAPEAL returns amount as value * 10^(-factor)
    // e.g., { value: 12345, factor: 2 } = 123.45
    return amount.value / Math.pow(10, amount.factor);
  }

  private async callApi<T>(
    url: string,
    method: Method = 'GET',
    data?: unknown,
    includePartnershipHeader = false,
  ): Promise<T> {
    if (!this.isAvailable()) throw new Error('YAPEAL is not configured');

    const { baseUrl, apiKey, partnershipUid } = Config.bank.yapeal;

    return this.http.request<T>({
      url: `${baseUrl}/${url}`,
      method,
      data,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'x-requestor-role': 'client',
        ...(includePartnershipHeader && { 'x-partnership-uid': partnershipUid }),
      },
    });
  }
}
