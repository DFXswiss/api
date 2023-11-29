import { Injectable, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { Method, ResponseType } from 'axios';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpError, HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { IdentConfig, IdentDocuments } from '../../dto/ident.dto';
import { KycStep } from '../../entities/kyc-step.entity';
import { KycStepType } from '../../enums/kyc.enum';

@Injectable()
export class IdentService {
  private readonly logger = new DfxLogger(IdentService);

  private readonly baseUrl = `${Config.kyc.gatewayHost}/api/v1`;

  constructor(private readonly http: HttpService) {}

  async initiateIdent(kycStep: KycStep): Promise<string> {
    if (!kycStep.transactionId) throw new InternalServerErrorException('Transaction ID is missing');

    return this.callApi<{ id: string }>(`identifications/${kycStep.transactionId}/start`, kycStep.type, 'POST').then(
      (r) => r.id,
    );
  }

  async getDocuments(kycStep: KycStep): Promise<IdentDocuments> {
    if (!kycStep.transactionId) throw new InternalServerErrorException('Transaction ID is missing');

    const pdf = await this.getDocument(kycStep.type, kycStep.transactionId, 'pdf');
    const zip = await this.getDocument(kycStep.type, kycStep.transactionId, 'zip');

    return {
      pdf: { name: `${kycStep.transactionId}.pdf`, content: pdf },
      zip: { name: `${kycStep.transactionId}.zip`, content: zip },
    };
  }

  // --- STATIC HELPER METHODS --- //
  static transactionId(user: UserData, kycStep: KycStep): string {
    return `${Config.kyc.transactionPrefix}-${kycStep.type}-${user.id}-${
      kycStep.sequenceNumber
    }-${Util.randomId()}`.toLowerCase();
  }

  static identUrl(kycStep: KycStep): string {
    return kycStep.type === KycStepType.AUTO
      ? `https://go.online-ident.ch/app/${Config.kyc.auto.customer}/identifications/${kycStep.sessionId}/identification/start`
      : `https://go.online-ident.ch/${Config.kyc.video.customer}/identifications/${kycStep.sessionId}`;
  }

  // --- HELPER METHODS --- //

  private async getDocument(kycStepType: KycStepType, transactionId: string, contentType: string): Promise<Buffer> {
    return this.callApi<string>(
      `identifications/${transactionId}.${contentType}`,
      kycStepType,
      'GET',
      {},
      'arraybuffer',
    ).then(Buffer.from);
  }

  private async callApi<T>(
    url: string,
    kycStepType: KycStepType,
    method: Method = 'GET',
    data: any = {},
    responseType?: ResponseType,
  ): Promise<T> {
    const identConfig = kycStepType === KycStepType.AUTO ? Config.kyc.auto : Config.kyc.video;

    return this.request<T>(url, method, identConfig, data, responseType).catch((e: HttpError) => {
      this.logger.verbose(`Error during intrum request ${method} ${url}: ${e.response?.status} ${e.response?.data}`);
      throw new ServiceUnavailableException({ status: e.response?.status, data: e.response?.data });
    });
  }

  private async request<T>(
    url: string,
    method: Method,
    identConfig: IdentConfig,
    data?: any,
    responseType?: ResponseType,
  ): Promise<T> {
    const { authToken } = await this.getAuthToken(identConfig);
    return this.http.request<T>({
      url: `${this.baseUrl}/${identConfig.customer}/${url}`,
      method: method,
      data: data,
      responseType,
      headers: {
        'Content-Type': 'application/json',
        'X-API-LOGIN-TOKEN': authToken,
      },
    });
  }

  private async getAuthToken(identConfig: IdentConfig): Promise<{ authToken: string }> {
    return this.http.request<{ authToken: string }>({
      url: `${this.baseUrl}/${identConfig.customer}/login`,
      method: 'POST',
      data: { apiKey: identConfig.apiKey },
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}
