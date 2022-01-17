import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Method } from 'axios';
import { createHash } from 'crypto';
import { UserInfo } from 'src/user/models/user/user.entity';
import { AccountType } from 'src/user/models/userData/account-type.enum';
import { RiskState } from 'src/user/models/userData/userData.entity';
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
  KycContentType,
  KycDocument,
  KycRelationType,
  SubmitResponse,
} from './dto/kyc.dto';

@Injectable()
export class KycApiService {
  private readonly baseUrl = 'https://kyc.eurospider.com/kyc-v8-api/rest/2.0.0';

  private sessionKey = 'session-key-will-be-updated';

  constructor(private http: HttpService) {}

  async createCustomer(id: number, name: string): Promise<CreateResponse> {
    const data = {
      reference: this.reference(id),
      type: 'PERSON',
      names: [{ lastName: name }],
      preferredLanguage: 'de',
    };

    return this.callApi<CreateResponse>('customers/simple', 'POST', data);
  }

  async updateCustomer(id: number, user: UserInfo): Promise<CreateResponse> {
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
          countryCode: user.country?.symbol?.toUpperCase() ?? 'DE',
        },
      ],
      preferredLanguage: user.language?.symbol?.toLowerCase() ?? 'de',
      activationDate: { year: new Date().getFullYear(), month: new Date().getMonth() + 1, day: new Date().getDate() },
    };

    return this.callApi<CreateResponse>('customers/simple', 'POST', data);
  }
  async getCustomerReferences(modificationTime: number): Promise<string[]> {
    return this.callApi<string[]>(`customers?modificationTime=${modificationTime}`, 'GET');
  }

  async getCustomer(id: number): Promise<Customer> {
    return this.callApi<Customer>(`customers/${this.reference(id)}`, 'GET');
  }

  async getCustomerInformation(userDataId: number): Promise<CustomerInformationResponse> {
    return this.callApi<CustomerInformationResponse>(`customers/${this.reference(userDataId)}/information`, 'GET');
  }

  async doCheckResult(userDataId: number): Promise<RiskState> {
    await this.checkCustomer(userDataId);
    return this.getCheckResult(userDataId);
  }

  async getCheckResult(userDataId: number): Promise<RiskState> {
    const customerInfo = await this.getCustomerInformation(userDataId);
    if (customerInfo.lastCheckId < 0) return undefined;

    const customerCheckResult = await this.callApi<CheckResult>(
      `customers/checks/${customerInfo.lastCheckId}/result`,
      'GET',
    );
    return customerCheckResult.risks[0].categoryKey;
  }

  async getCustomerDocumentVersionParts(id: number, document: string, version: string): Promise<CheckResult> {
    return this.callApi<any>(`customers/${this.reference(id)}/documents/${document}/versions/${version}/parts`, 'GET');
  }

  async downloadCustomerDocumentVersionParts(id: number, document: string, version: string): Promise<any> {
    return this.callApi<any>(
      `customers/${this.reference(id)}/documents/${document}/versions/${version}/parts/export`,
      'GET',
    );
  }

  async getDocuments(id: number): Promise<CheckResult> {
    return this.callApi<any>(`customers/${this.reference(id)}/documents/`, 'GET');
  }

  async checkCustomer(id: number): Promise<CheckResponse> {
    const results = await this.callApi<CheckResponse[]>('customers/check', 'POST', [this.reference(id)]);
    return results[0];
  }

  async initiateOnboardingChatBot(id: number, sendMail: boolean): Promise<ChatBotResponse> {
    const style = {
      headerColor: '#FFFFFF',
      textColor: '#FFFFFF',
      warningColor: '#F5516C',
      backgroundColor: '#072440',
      overlayBackgroundColor: '#072440',
      buttonColor: '#FFFFFF',
      buttonBackgroundColor: '#F5516C',
      bubbleLeftColor: '#FFFFFF',
      bubbleLeftBackgroundColor: '#0A355C',
      bubbleRightColor: '#FFFFFF',
      bubbleRightBackgroundColor: '#0A355C',
      htmlHeaderInclude: '',
      htmlBodyInclude: '',
    };

    const data = {
      references: [this.reference(id)],
      sendingInvitation: sendMail,
      overridingStyleInfo: style,
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

    const result = await this.callApi<ChatBotResponse>('customers/contract-linked', 'POST', data);
    return result[0];
  }

  async submitContractLinkedList(id: number, user: UserInfo): Promise<SubmitResponse[]> {
    let organization = {};
    const person = {
      contractReference:
        user.accountType === AccountType.BUSINESS || user.accountType === AccountType.SELF
          ? this.reference(id) + '_placeholder'
          : null,
      customer: {
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
            countryCode: user.country?.symbol?.toUpperCase() ?? 'DE',
          },
        ],
        preferredLanguage: user.language?.symbol?.toLowerCase() ?? 'de',
        activationDate: { year: new Date().getFullYear(), month: new Date().getMonth() + 1, day: new Date().getDate() },
      },
      relationTypes:
        user.accountType === AccountType.BUSINESS || user.accountType === AccountType.SELF
          ? [KycRelationType.CONVERSION_PARTNER, KycRelationType.CONTROLLER]
          : [KycRelationType.CONTRACTING_PARTNER, KycRelationType.CONVERSION_PARTNER, KycRelationType.CONTROLLER],
    };

    if (user.accountType === AccountType.BUSINESS || user.accountType === AccountType.SELF) {
      organization = {
        customer: {
          reference: this.reference(id, true),
          type: 'ORGANISATION',
          names: [user.organizationName],
          countriesOfResidence: [user.organizationCountry?.symbol?.toUpperCase() ?? 'DE'],
          structuredAddresses: [
            {
              type: 'BASIC',
              street: user.organizationStreet,
              houseNumber: user.organizationHouseNumber,
              zipCode: user.organizationZip,
              city: user.organizationLocation,
              countryCode: user.organizationCountry?.symbol?.toUpperCase() ?? 'DE',
            },
          ],
        },
        contractReference: this.reference(id) + '_placeholder',
        relationTypes: [KycRelationType.CONTRACTING_PARTNER],
      };
    }

    const result = await this.callApi<SubmitResponse[]>(
      'customers/contract-linked-list',
      'POST',
      user.accountType === AccountType.BUSINESS || user.accountType === AccountType.SELF
        ? [person, organization]
        : [person],
    );
    return result;
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

  async uploadDocument(
    id: number,
    kycDocumentVersion: string,
    kycDocument: KycDocument,
    kycDocumentPart: string,
    kycContentType: KycContentType,
    kycData: any,
    isOrganization: boolean,
  ): Promise<boolean> {
    const result = await this.callApi<string>(
      `customers/${this.reference(
        id,
        isOrganization,
      )}/documents/${kycDocument}/versions/${kycDocumentVersion}/parts/${kycDocumentPart}`,
      'PUT',
      kycData,
      kycContentType,
    );

    return result === 'done';
  }

  async changeDocumentState(
    id: number,
    kycDocumentVersion: string,
    kycDocument: KycDocument,
    kycState: string,
    isOrganization: boolean,
  ): Promise<boolean> {
    const result = await this.callApi<string>(
      `customers/${this.reference(id, isOrganization)}/documents/${kycDocument}/versions/${kycDocumentVersion}/state`,
      'PUT',
      kycState,
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

  async createDocumentVersion(
    id: number,
    document: KycDocument,
    version: string,
    isOrganization: boolean,
  ): Promise<boolean> {
    const data = {
      name: version,
    };
    const result = await this.callApi<string>(
      `customers/${this.reference(id, isOrganization)}/documents/${document}/versions/${version}`,
      'PUT',
      data,
    );
    return result === 'done';
  }

  async createDocumentVersionPart(
    id: number,
    document: KycDocument,
    version: string,
    part: string,
    fileName: string,
    contentType: KycContentType,
    isOrganization: boolean,
  ): Promise<boolean> {
    const data = {
      name: part,
      label: part,
      fileName: fileName,
      contentType: contentType,
    };
    const result = await this.callApi<string>(
      `customers/${this.reference(
        id,
        isOrganization,
      )}/documents/${document}/versions/${version}/parts/${part}/metadata`,
      'PUT',
      data,
    );
    return result === 'done';
  }

  // --- HELPER METHODS --- //
  private reference(id: number, isOrganization = false): string {
    const ref = process.env.KYC_PREFIX ? `${process.env.KYC_PREFIX}${id}` : id.toString();
    return isOrganization ? `${ref}_organization` : ref;
  }

  private async callApi<T>(url: string, method: Method, data?: any, contentType?: any): Promise<T> {
    return this.request<T>(url, method, data, contentType).catch((e: HttpError) => {
      if (e.response?.status === 404) {
        return null;
      }

      throw new ServiceUnavailableException(e);
    });
  }

  private async request<T>(
    url: string,
    method: Method,
    data?: any,
    contentType?: any,
    nthTry = 3,
    getNewKey = false,
  ): Promise<T> {
    try {
      if (getNewKey) this.sessionKey = await this.getNewSessionKey();

      return await this.http.request<T>({
        url: `${this.baseUrl}/${url}`,
        method: method,
        data: data,
        headers: {
          'Content-Type': contentType ?? 'application/json',
          'Session-Key': this.sessionKey,
        },
      });
    } catch (e) {
      if (nthTry > 1 && e.response?.status === 403) {
        return this.request(url, method, data, contentType, nthTry - 1, true);
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
