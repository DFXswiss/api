import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Method, ResponseType } from 'axios';
import * as crypto from 'crypto';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpError, HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { IdentResultDto } from '../../dto/input/ident-result.dto';
import { KycStep } from '../../entities/kyc-step.entity';

@Injectable()
export class SumSubService {
  private readonly logger = new DfxLogger(SumSubService);

  private readonly baseUrl = `https://api.sumsub.com`;

  constructor(private readonly http: HttpService) {}

  async createApplicant(externalUserId: string, kycLevel: string): Promise<void> {
    await this.callApi<{ id: string }>(
      `/resources/applicants?levelName=${kycLevel}`,
      'POST',
      JSON.stringify({ externalUserId }),
    );
  }

  async createWebLink(externalUserId: string, kycLevel: string, lang: string): Promise<{ url: string }> {
    return this.callApi<{ url: string }>(
      `/resources/sdkIntegrations/levels/${kycLevel}/websdkLink?externalUserId=${externalUserId}&lang=${lang}`,
      'POST',
      JSON.stringify({}),
    );
  }

  async getResult(kycStep: KycStep): Promise<IdentResultDto> {
    return this.callApi<IdentResultDto>(`identifications/${kycStep.transactionId}`, 'GET');
  }

  // --- STATIC HELPER METHODS --- //
  static transactionId(user: UserData, kycStep: KycStep): string {
    return `${Config.kyc.transactionPrefix}-${kycStep.type}-${user.id}-${
      kycStep.sequenceNumber
    }-${Util.randomId()}`.toLowerCase();
  }

  // --- HELPER METHODS --- //
  private async callApi<T>(
    url: string,
    method: Method = 'GET',
    data: any = {},
    responseType?: ResponseType,
  ): Promise<T> {
    return this.request<T>(url, method, data, responseType).catch((e: HttpError) => {
      this.logger.verbose(`Error during sum sub request ${method} ${url}: ${e.response?.status} ${e.response?.data}`);
      throw new ServiceUnavailableException({ status: e.response?.status, data: e.response?.data });
    });
  }

  private async request<T>(url: string, method: Method, data?: any, responseType?: ResponseType): Promise<T> {
    const { ts, signature } = await this.createAccess(method, url, data);
    return this.http.request<T>({
      url: `${this.baseUrl}${url}`,
      method: method,
      data: data,
      responseType,
      headers: {
        'Content-Type': 'application/json',
        'X-App-Token': Config.kyc.appToken,
        'X-App-Access-Sig': signature,
        'X-App-Access-Ts': ts,
      },
    });
  }

  private async createAccess(method: Method, url: string, data: any): Promise<{ ts: number; signature: string }> {
    const ts = Math.floor(Date.now() / 1000);
    const signature = crypto.createHmac('sha256', Config.kyc.secretKey);
    signature.update(ts + method.toUpperCase() + url);
    signature.update(data);
    return { ts, signature: signature.digest('hex') };
  }
}
