import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Method } from 'axios';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpError, HttpService } from 'src/shared/services/http.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycStepType } from '../../enums/kyc.enum';

@Injectable()
export class IdentService {
  constructor(private readonly http: HttpService) {}
  private readonly logger = new DfxLogger(IdentService);

  private customer = '';
  private readonly baseUrl = `${Config.kyc.gatewayHost}/api/v1`;

  async initiateIdent(user: UserData, kycStepType: KycStepType, identificationId: string): Promise<{ id: string }> {
    const userData = {
      birthday: user.birthday,
      birthplace: user.location,
      email: user.mail,
      firstname: user.firstname,
      lastname: user.surname,
      mobilephone: user.phone,
      nationality: user.nationality,
      zipcode: user.zip,
    };
    return this.callApi<{ id: string }>(`identifications/${identificationId}/start`, 'POST', kycStepType, userData);
  }

  // --- HELPER METHODS --- //

  private async callApi<T>(url: string, method: Method = 'GET', kycStepType: KycStepType, data?: any): Promise<T> {
    this.customer = kycStepType == KycStepType.AUTO ? Config.kyc.customerAuto : Config.kyc.customerVideo;
    return this.request<T>(url, method, data).catch((e: HttpError) => {
      this.logger.verbose(`Error during intrum request ${method} ${url}: ${e.response?.status} ${e.response?.data}`);
      throw new ServiceUnavailableException({ status: e.response?.status, data: e.response?.data });
    });
  }

  private async request<T>(url: string, method: Method, data?: any): Promise<T> {
    const { authToken } = await this.getAuthToken();
    return this.http.request<T>({
      url: `${this.baseUrl}/${this.customer}/${url}`,
      method: method,
      data: data,
      headers: {
        'Content-Type': 'application/json',
        'X-API-LOGIN-TOKEN': authToken,
      },
    });
  }

  private async getAuthToken(): Promise<{ authToken: string }> {
    return this.http.request<{ authToken: string }>({
      url: `${this.baseUrl}/${this.customer}/login`,
      method: 'POST',
      data: { apiKey: Config.kyc.apiKey },
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}
