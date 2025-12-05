import { Injectable } from '@nestjs/common';
import { Method } from 'axios';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';

// Request/Response interfaces based on YAPEAL B2B Account API documentation

interface VibanReserveRequest {
  baseAccountIBAN: string;
  bban: string;
}

interface VibanReserveResponse {
  accountUid: string;
  bban: string;
  expiresAt: string;
  iban: string;
}

interface VibanProposalResponse {
  bban: string;
  iban: string;
}

interface VibanListResponse {
  vIBANS: Array<{
    vIBAN: string;
    vQrIBAN?: string;
  }>;
}

@Injectable()
export class YapealService {
  private readonly logger = new DfxLogger(YapealService);

  constructor(private readonly http: HttpService) {}

  /**
   * Reserve a virtual IBAN for a partnership
   * POST /b2b/v2/partnerships/{uid}/cash-accounts/viban/reserve
   */
  async reserveViban(bban: string): Promise<VibanReserveResponse> {
    const { partnershipUid, baseAccountIban } = Config.bank.yapeal;

    if (!partnershipUid || !baseAccountIban) {
      throw new Error('YAPEAL configuration incomplete: partnershipUid or baseAccountIban missing');
    }

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

  /**
   * Get a VIBAN proposal for a partnership
   * GET /b2b/v2/partnerships/{uid}/viban/proposal
   */
  async getVibanProposal(): Promise<VibanProposalResponse> {
    const { partnershipUid } = Config.bank.yapeal;

    if (!partnershipUid) {
      throw new Error('YAPEAL configuration incomplete: partnershipUid missing');
    }

    return this.callApi<VibanProposalResponse>(`b2b/v2/partnerships/${partnershipUid}/viban/proposal`, 'GET');
  }

  /**
   * List all VIBANs for a cash account
   * GET /b2b/v2/cash-accounts/{uid}/vibans
   */
  async listVibans(accountUid: string): Promise<VibanListResponse> {
    return this.callApi<VibanListResponse>(`b2b/v2/cash-accounts/${accountUid}/vibans`, 'GET');
  }

  // --- HELPER METHODS --- //

  private async callApi<T>(url: string, method: Method = 'GET', data?: unknown): Promise<T> {
    const { baseUrl, apiKey } = Config.bank.yapeal;

    if (!baseUrl || !apiKey) {
      throw new Error('YAPEAL configuration incomplete: baseUrl or apiKey missing');
    }

    try {
      return await this.http.request<T>({
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
    } catch (e) {
      this.logger.error(`YAPEAL API call failed [${method} ${url}]:`, e);
      throw e;
    }
  }
}
