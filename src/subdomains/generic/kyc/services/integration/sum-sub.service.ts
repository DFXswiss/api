import { Injectable, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { Method, ResponseType } from 'axios';
import * as crypto from 'crypto';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpError, HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { IdentDocument } from '../../dto/ident.dto';
import { ContentType } from '../../dto/kyc-file.dto';
import { ApplicantType, DataResult, SumsubResult } from '../../dto/sum-sub.dto';
import { KycStep } from '../../entities/kyc-step.entity';

@Injectable()
export class SumsubService {
  private readonly logger = new DfxLogger(SumsubService);

  private readonly baseUrl = `https://api.sumsub.com`;
  private readonly kycLevel = 'basic-kyc-level';
  // private static readonly algoMap: { [key: string]: string } = {
  //   HMAC_SHA1_HEX: 'sha1',
  //   HMAC_SHA256_HEX: 'sha256',
  //   HMAC_SHA512_HEX: 'sha512',
  // };

  constructor(private readonly http: HttpService) {}

  async initiateIdent(user: UserData, kycStep: KycStep): Promise<string> {
    if (!kycStep.transactionId) throw new InternalServerErrorException('Transaction ID is missing');

    await this.createApplicant(kycStep.transactionId, user);
    return this.generateAccessToken(kycStep.transactionId).then((r) => r.token);
  }

  async getDocuments(kycStep: KycStep): Promise<IdentDocument[]> {
    const { webhook } = kycStep.getResult<SumsubResult>();

    const content = await this.callApi<string>(
      `/resources/applicants/${webhook.applicantId}/summary/report?report=${
        webhook.applicantType == ApplicantType.COMPANY ? 'companyReport' : 'applicantReport'
      }`,
      'GET',
      '{}',
      'arraybuffer',
    ).then(Buffer.from);

    return [{ name: this.fileName(kycStep.transactionId, 'pdf'), content, contentType: ContentType.PDF }];
  }

  async getApplicantData(applicantId: string): Promise<DataResult> {
    return this.callApi<DataResult>(`/resources/applicants/${applicantId}/one`, 'GET');
  }

  // --- STATIC HELPER METHODS --- //
  static transactionId(user: UserData, kycStep: KycStep): string {
    return `${Config.kyc.transactionPrefix}-${kycStep.type}-${user.id}-${
      kycStep.sequenceNumber
    }-${Util.randomId()}`.toLowerCase();
  }

  static checkWebhook(_req: Request, _data: any): boolean {
    return true; // TODO: implement check

    // const algoHeader = req.headers['x-payload-digest-alg'];
    // const algo = SumsubService.algoMap[algoHeader as string];
    // if (!algo) return false;

    // const buffer = Buffer.from(data.toString());

    // const calculatedDigest = crypto.createHmac(algo, Config.kyc.webhookKey).update(buffer).digest('hex');

    // return calculatedDigest === req.headers['x-payload-digest'];
  }

  static identUrl(kycStep: KycStep): string {
    return kycStep.sessionId;
  }

  // --- HELPER METHODS --- //
  private async createApplicant(transactionId: string, user: UserData): Promise<void> {
    const data = {
      externalUserId: transactionId,
      type: ApplicantType.INDIVIDUAL,
      fixedInfo: {
        firstName: user.firstname,
        lastName: user.surname,
        country: user.country?.symbol3,
        dob: user.birthday && Util.isoDate(user.birthday),
        nationality: user.nationality?.symbol3,
        addresses: [
          {
            street: user.street + (user.houseNumber ? ` ${user.houseNumber}` : ''),
            postCode: user.zip,
            town: user.location,
            country: user.country?.symbol3,
          },
        ],
      },
    };
    await this.callApi<{ id: string }>(`/resources/applicants?levelName=${this.kycLevel}`, 'POST', data);
  }

  private async generateAccessToken(transactionId: string): Promise<{ token: string }> {
    const expirySecs = Config.kyc.identFailAfterDays * 24 * 60 * 60;
    return this.callApi<{ token: string }>(
      `/resources/accessTokens?userId=${transactionId}&levelName=basic-kyc-level&ttlInSecs=${expirySecs}`,
      'POST',
    );
  }

  private async callApi<T>(
    url: string,
    method: Method = 'GET',
    data: any = {},
    responseType?: ResponseType,
  ): Promise<T> {
    return this.request<T>(url, method, JSON.stringify(data), responseType).catch((e: HttpError) => {
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

  private fileName(transactionId: string, contentType: string): string {
    return `${Util.isoDateTime(new Date()).split('-').join('')}-${transactionId}.${contentType}`;
  }
}
