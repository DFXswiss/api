import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Method } from 'axios';
import { createHash } from 'crypto';
import { User } from 'src/user/models/user/user.entity';
import { HttpError, HttpService } from '../../../shared/services/http.service';
import {
  Challenge,
  ChatBotResponse,
  CheckResponse,
  CheckResult,
  CheckVersion,
  CreateResponse,
  Customer,
  CustomerInformationResponse,
  IdentificationResponse,
  KycDocument,
} from './dto/kyc.dto';

@Injectable()
export class KycApiService {
  private readonly baseUrl = 'https://kyc.eurospider.com/kyc-v8-api/rest/2.0.0';

  private sessionKey = 'session-key-will-be-updated';

  constructor(private http: HttpService) { }

  async createCustomer(id: number, name: string): Promise<CreateResponse> {
    const data = {
      reference: this.reference(id),
      type: 'PERSON',
      names: [{ lastName: name }],
      preferredLanguage: 'de',
    };

    return this.callApi<CreateResponse>('customers/simple', 'POST', data);
  }

  async updateCustomer(id: number, user: User): Promise<CreateResponse> {
    const data = {
      reference: this.reference(id),
      type: 'PERSON',
      names: [{ firstName: user.firstname, lastName: user.surname }],
      countriesOfResidence: [user.country.symbol],
      emails: [user.mail],
      telephones: [user.phone?.replace('+', '').replace(' ', '')],
      structuredAddresses: [
        {
          type: 'BASIC',
          street: user.street,
          houseNumber: user.houseNumber,
          zipCode: user.zip,
          city: user.location,
          countryCode: user.country?.symbol?.toLowerCase() ?? 'de',
        },
      ],
      preferredLanguage: user.language?.symbol?.toLowerCase() ?? 'de',
      activationDate: { year: new Date().getFullYear(), month: new Date().getMonth() + 1, day: new Date().getDate() },
    };

    return this.callApi<CreateResponse>('customers/simple', 'POST', data);
  }
  async getAllCustomer(): Promise<string[]> {
    return this.callApi<string[]>(`customers`, 'GET');
  }

  async getCustomer(id: number): Promise<Customer> {
    return this.callApi<Customer>(`customers/${this.reference(id)}`, 'GET');
  }

  async getCustomerInformation(userDataId: number): Promise<CustomerInformationResponse> {
    return this.callApi<CustomerInformationResponse>(`customers/${this.reference(userDataId)}/information`, 'GET');
  }

  async getCheckResult(userDataId: number): Promise<CheckResult> {
    const customerCheckId = await this.getCustomerInformation(userDataId);
    return customerCheckId?.lastCheckId >= 0
      ? await this.callApi<CheckResult>(`customers/checks/${customerCheckId.lastCheckId}/result`, 'GET')
      : null;
  }

  async getDocuments(id: number): Promise<CheckResult> {
    return this.callApi<any>(`customers/${this.reference(id)}/documents`, 'GET');
  }

  async checkCustomer(id: number): Promise<CheckResponse> {
    const results = await this.callApi<CheckResponse[]>('customers/check', 'POST', [this.reference(id)]);
    return results[0];
  }

  async initiateOnboardingChatBot(id: number): Promise<ChatBotResponse> {
    const data = {
      references: [this.reference(id)],
      sendingInvitation: true,
    };

    const result = await this.callApi<ChatBotResponse[]>(
      'customers/initiate-onboarding-chatbot-sessions',
      'POST',
      data,
    );
    return result[0];
  }

  async createFileReference(id: number, fileReference: number, lastName: string): Promise<ChatBotResponse> {
    const data = {
      customer: {
        reference: this.reference(id),
        type: 'PERSON',
        names: [{ lastName: lastName }],
      },
      contractReference: this.reference(fileReference),
    };

    const result = await this.callApi<any>('customers/contract-linked', 'POST', data);
    return result[0];
  }

  async initiateOnlineIdentification(id: number): Promise<IdentificationResponse> {
    const result = await this.callApi<any>('customers/initiate-online-identifications', 'POST', [this.reference(id)]);
    return result[0];
  }

  async initiateVideoIdentification(id: number): Promise<IdentificationResponse> {
    const result = await this.callApi<any>('customers/initiate-video-identifications', 'POST', [this.reference(id)]);
    return result[0];
  }

  async initiateDocumentUpload(id: number, kycDocuments: KycDocument[]): Promise<IdentificationResponse> {
    const query: string = this.getUploadDocumentQuery(kycDocuments);

    const result = await this.callApi<IdentificationResponse[]>(
      `customers/initiate-document-uploads?${query}`,
      'POST',
      [this.reference(id)],
    );
    return result[0];
  }

  async uploadDocument(id: number, kycDocumentVersion: string, kycDocument: KycDocument): Promise<boolean> {
    //TODO BODY with IMG rawData

    const result = await this.callApi<string>(
      `customers/${this.reference(
        id,
      )}/documents/${kycDocument}/versions/${kycDocumentVersion}/parts/${kycDocumentVersion}`,
      'PUT',
      'image/jpeg',
    );

    return result === 'done';
  }

  getUploadDocumentQuery(queryArray: KycDocument[]): string {
    let resultString = '';
    queryArray.forEach((a) => (resultString += 'documentName=' + a + '&'));
    return resultString.slice(0, -1);
  }

  async getDocumentVersion(id: number, document: KycDocument): Promise<CheckVersion[]> {
    return this.callApi<CheckVersion[]>(`customers/${this.reference(id)}/documents/${document}/versions`, 'GET');
  }

  async createDocumentVersion(id: number, document: KycDocument, version: string): Promise<boolean> {
    const data = {
      name: 'ident',
      state: 'PENDING',
    };

    const result = await this.callApi<string>(
      `customers/${this.reference(id)}/documents/${document}/versions/${version}`,
      'PUT',
      data,
    );
    return result === 'done';
  }

  async createDocumentVersionPart(id: number, document: string, version: string, part: string): Promise<boolean> {
    const data = {
      name: 'ident',
      label: 'ident',
      fileName: 'ident.img',
      contentType: 'image/jpeg',
    };

    const result = await this.callApi<string>(
      `customers/${this.reference(id)}/documents/${document}/versions/${version}/parts/${part}/metadata`,
      'PUT',
      data,
    );
    return result === 'done';
  }

  // --- HELPER METHODS --- //
  private reference(id: number): string {
    return process.env.KYC_PREFIX ? `${process.env.KYC_PREFIX}${id}` : id.toString();
  }

  private async callApi<T>(url: string, method: Method, data?: any, contentType?: any): Promise<T> {
    return this.request<T>(this.sessionKey, url, method, 3, data, contentType).catch((e: HttpError) => {
      if (e.response?.status === 404) {
        return null;
      }

      throw new ServiceUnavailableException(e);
    });
  }

  private async request<T>(
    sessionKey: string,
    url: string,
    method: Method,
    nthTry = 3,
    data?: any,
    contentType?: any,
  ): Promise<T> {
    try {
      return await this.http.request<T>({
        url: `${this.baseUrl}/${url}`,
        method: method,
        data: data,
        headers: {
          'Content-Type': contentType ?? 'application/json',
          'Session-Key': sessionKey,
        },
      });
    } catch (e) {
      if (nthTry > 1 && e.response?.status === 403) {
        console.log(`KYC call: Retry ${this.baseUrl}/${url} (Try number ${4 - nthTry})`);
        this.sessionKey = await this.getNewSessionKey();
        return this.request(this.sessionKey, url, method, nthTry - 1, data, contentType);
      }

      throw e;
    }
  }

  private async getNewSessionKey(): Promise<string> {
    // get the challenge
    const { key, challenge } = await this.http.get<Challenge>(`${this.baseUrl}/challenge`);

    // determine response
    const response = key + process.env.KYC_MANDATOR + process.env.KYC_USER + process.env.KYC_PASSWORD + challenge;
    const hash = createHash('sha1');
    hash.update(response);

    const data = {
      key: key,
      mandator: process.env.KYC_MANDATOR,
      user: process.env.KYC_USER,
      response: hash.digest('hex'),
    };

    // enable the session key
    await this.http.post(`${this.baseUrl}/authenticate`, data);

    return key;
  }
}
