import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Method, ResponseType } from 'axios';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { HttpError, HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { IdNowResult } from '../../dto/ident-result.dto';
import { IdentConfig, IdentDocument } from '../../dto/ident.dto';
import { KycStep } from '../../entities/kyc-step.entity';
import { ContentType } from '../../enums/content-type.enum';
import { KycStepName } from '../../enums/kyc-step-name.enum';
import { KycStepType } from '../../enums/kyc.enum';

@Injectable()
export class IdentService {
  private readonly logger: DfxLogger;
  private readonly baseUrl = `${Config.kyc.gatewayHost}/api/v1`;

  constructor(readonly loggerFactory: LoggerFactory, private readonly http: HttpService) {
    this.logger = loggerFactory.create(IdentService);
  }

  async initiateIdent(user: UserData, kycStep: KycStep): Promise<string> {
    if (!kycStep.transactionId) throw new InternalServerErrorException('Transaction ID is missing');

    const videoIdentSteps = user.getStepsWith(KycStepName.IDENT, KycStepType.VIDEO);
    if (videoIdentSteps.some((s) => !s.isFailed) && kycStep.type === KycStepType.VIDEO)
      throw new BadRequestException('You cannot start another video ident');

    const data = {
      firstname: user.firstname,
      lastname: user.surname,
      street: user.street + (user.houseNumber ? ` ${user.houseNumber}` : ''),
      zipcode: user.zip,
      city: user.location,
      country: user.country?.symbol,
      birthday: user.birthday && Util.isoDate(user.birthday),
      nationality: user.nationality?.symbol,
    };

    return this.callApi<{ id: string }>(
      `identifications/${kycStep.transactionId}/start`,
      kycStep.type,
      'POST',
      data,
    ).then((r) => r.id);
  }

  async getResult(kycStep: KycStep): Promise<IdNowResult> {
    return this.callApi<IdNowResult>(`identifications/${kycStep.transactionId}`, kycStep.type, 'GET');
  }

  async getDocuments(kycStep: KycStep): Promise<IdentDocument[]> {
    if (!kycStep.transactionId) throw new InternalServerErrorException('Transaction ID is missing');

    const pdf = await this.getDocument(kycStep.type, kycStep.transactionId, 'pdf');
    const zip = await this.getDocument(kycStep.type, kycStep.transactionId, 'zip');
    const mp3 =
      kycStep.type === KycStepType.VIDEO && (await this.getDocument(kycStep.type, kycStep.transactionId, 'mp3'));

    return [
      pdf && {
        name: this.fileName(kycStep.transactionId, 'pdf'),
        content: pdf,
        contentType: ContentType.PDF,
      },
      zip && {
        name: this.fileName(kycStep.transactionId, 'zip'),
        content: zip,
        contentType: ContentType.ZIP,
      },
      mp3 && {
        name: this.fileName(kycStep.transactionId, 'mp3'),
        content: mp3,
        contentType: ContentType.MP3,
      },
    ].filter((d) => d);
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

  private fileName(transactionId: string, contentType: string): string {
    return `${Util.isoDateTime(new Date()).split('-').join('')}-${transactionId}.${contentType}`;
  }

  private async getDocument(
    kycStepType: KycStepType,
    transactionId: string,
    contentType: string,
  ): Promise<Buffer | undefined> {
    return this.callApi<string>(
      `identifications/${transactionId}.${contentType}`,
      kycStepType,
      'GET',
      {},
      'arraybuffer',
    )
      .then(Buffer.from)
      .catch((e) => {
        this.logger.error(`Failed to fetch ${contentType} document for ${transactionId}:`, e);
        return undefined;
      });
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
