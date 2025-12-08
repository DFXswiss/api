import { Injectable } from '@nestjs/common';
import { Method } from 'axios';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { VibanListResponse, VibanProposalResponse, VibanReserveRequest, VibanReserveResponse } from '../dto/yapeal.dto';

@Injectable()
export class YapealService {
  constructor(private readonly http: HttpService) {}

  isAvailable(): boolean {
    const { baseUrl, apiKey, partnershipUid } = Config.bank.yapeal;
    return !!(baseUrl && apiKey && partnershipUid);
  }

  async createViban(): Promise<VibanReserveResponse> {
    const proposal = await this.getVibanProposal();
    return this.reserveViban(proposal.bban);
  }

  async listVibans(accountUid: string): Promise<VibanListResponse> {
    return this.callApi<VibanListResponse>(`b2b/v2/cash-accounts/${accountUid}/vibans`, 'GET');
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

  private async callApi<T>(url: string, method: Method = 'GET', data?: unknown): Promise<T> {
    if (!this.isAvailable()) throw new Error('YAPEAL is not configured');

    const { baseUrl, apiKey } = Config.bank.yapeal;

    return this.http.request<T>({
      url: `${baseUrl}/${url}`,
      method,
      data,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'x-requestor-role': 'client',
      },
    });
  }
}
