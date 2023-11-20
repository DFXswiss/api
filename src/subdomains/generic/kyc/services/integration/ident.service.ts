import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Method } from 'axios';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpError, HttpService } from 'src/shared/services/http.service';
import { KycStep } from '../../entities/kyc-step.entity';
import { KycStepType } from '../../enums/kyc.enum';

@Injectable()
export class IdentService {
  private readonly logger = new DfxLogger(IdentService);

  private readonly baseUrl = `${Config.kyc.gatewayHost}/api/v1`;

  constructor(private readonly http: HttpService) {}

  async initiateIdent(kycStepType: KycStepType, transactionId: string): Promise<string> {
    return this.callApi<{ id: string }>(`identifications/${transactionId}/start`, kycStepType, 'POST').then(
      (r) => r.id,
    );
  }

  static identUrl(kycStep: KycStep): string {
    return `https://go.online-ident.ch/app/${Config.kyc.customerAuto}/identifications/${kycStep.sessionId}/identification/start`;
  }

  // --- HELPER METHODS --- //

  private async callApi<T>(url: string, kycStepType: KycStepType, method: Method = 'GET', data: any = {}): Promise<T> {
    const customer = kycStepType === KycStepType.AUTO ? Config.kyc.customerAuto : Config.kyc.customerVideo;

    return this.request<T>(url, method, customer, data).catch((e: HttpError) => {
      this.logger.verbose(`Error during intrum request ${method} ${url}: ${e.response?.status} ${e.response?.data}`);
      throw new ServiceUnavailableException({ status: e.response?.status, data: e.response?.data });
    });
  }

  private async request<T>(url: string, method: Method, customer: string, data?: any): Promise<T> {
    const { authToken } = await this.getAuthToken(customer);
    return this.http.request<T>({
      url: `${this.baseUrl}/${customer}/${url}`,
      method: method,
      data: data,
      headers: {
        'Content-Type': 'application/json',
        'X-API-LOGIN-TOKEN': authToken,
      },
    });
  }

  private async getAuthToken(customer: string): Promise<{ authToken: string }> {
    return this.http.request<{ authToken: string }>({
      url: `${this.baseUrl}/${customer}/login`,
      method: 'POST',
      data: { apiKey: Config.kyc.apiKey },
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}
