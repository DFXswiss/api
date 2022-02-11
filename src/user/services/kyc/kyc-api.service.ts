import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Method } from 'axios';
import { createHash } from 'crypto';
import { Config } from 'src/config/config';
import { UserInfo } from 'src/user/models/user/user.entity';
import { RiskState } from 'src/user/models/userData/userData.entity';
import { HttpError, HttpService } from '../../../shared/services/http.service';
import {
  Challenge,
  CheckResponse,
  CheckResult,
  DocumentVersion,
  CreateResponse,
  Customer,
  CustomerInformationResponse,
  InitiateResponse,
  KycContentType,
  KycDocument,
  KycDocumentState,
  KycRelationType,
  Organization,
  SubmitResponse,
} from './dto/kyc.dto';

@Injectable()
export class KycApiService {
  private readonly baseUrl = 'https://kyc.eurospider.com/kyc-v8-api/rest';
  private readonly baseVersion = '2.0.0';

  private sessionKey = 'session-key-will-be-updated';

  constructor(private readonly http: HttpService) {}

  // --- CUSTOMER --- //
  async getCustomer(id: number): Promise<Customer> {
    return this.callApi<Customer>(`customers/${this.reference(id)}`, 'GET');
  }

  async getCustomerInfo(id: number): Promise<CustomerInformationResponse> {
    return this.callApi<CustomerInformationResponse>(`customers/${this.reference(id)}/information`, 'GET');
  }

  async getChangedCustomers(modificationTime: number): Promise<string[]> {
    return this.callApi<string[]>(`customers?modificationTime=${modificationTime}`, 'GET');
  }

  async createCustomer(id: number, name: string): Promise<CreateResponse | undefined> {
    const customer = await this.getCustomer(id);
    if (!customer) {
      const person = {
        contractReference: this.reference(id) + '_placeholder',
        customer: {
          reference: this.reference(id),
          type: 'PERSON',
          names: [{ lastName: name }],
          preferredLanguage: Config.defaultLanguage,
        },
      };

      return this.callApi<CreateResponse>('customers/contract-linked-list', 'POST', [person]);
    }
  }

  async updateCustomer(customer: Customer): Promise<void> {
    await this.callApi<CreateResponse>('customers/simple', 'POST', customer);
  }

  async updatePersonalCustomer(id: number, user: UserInfo): Promise<SubmitResponse[] | CreateResponse> {
    const customer = this.buildCustomer(id, user);

    // handle legacy customers without contract reference
    const customerInfo = await this.getCustomerInfo(id);
    if (!customerInfo || customerInfo.contractReference) {
      const person = {
        contractReference: this.reference(id) + '_placeholder',
        customer,
        relationTypes: [
          KycRelationType.CONVERSION_PARTNER,
          KycRelationType.BENEFICIAL_OWNER,
          KycRelationType.CONTRACTING_PARTNER,
        ],
      };

      return await this.callApi<SubmitResponse[]>('customers/contract-linked-list', 'POST', [person]);
    } else {
      return this.callApi<CreateResponse>('customers/simple', 'POST', customer);
    }
  }

  async updateOrganizationCustomer(id: number, user: UserInfo): Promise<SubmitResponse[]> {
    const person = {
      contractReference: this.reference(id) + '_placeholder',
      customer: this.buildCustomer(id, user),
      relationTypes: [KycRelationType.CONVERSION_PARTNER, KycRelationType.CONTROLLER],
    };

    const organization = {
      contractReference: this.reference(id) + '_placeholder',
      customer: this.buildOrganization(id, user),
      relationTypes: [KycRelationType.CONTRACTING_PARTNER],
    };

    return await this.callApi<SubmitResponse[]>('customers/contract-linked-list', 'POST', [person, organization]);
  }

  private buildCustomer(id: number, user: UserInfo): Partial<Customer> {
    const preferredLanguage = ['es', 'pt'].includes(user.language?.symbol?.toLowerCase())
      ? 'en'
      : user.language?.symbol?.toLowerCase();

    return {
      reference: this.reference(id),
      type: 'PERSON',
      names: [{ firstName: user.firstname, lastName: user.surname }],
      countriesOfResidence: [user.country.symbol],
      emails: [user.mail],
      telephones: [user.phone?.replace('+', '').split(' ').join('')],
      structuredAddresses: [
        {
          type: 'BASIC',
          street: user.street,
          houseNumber: user.houseNumber,
          zipCode: user.zip,
          city: user.location,
          countryCode: user.country?.symbol?.toUpperCase() ?? Config.defaultCountry,
        },
      ],
      preferredLanguage: preferredLanguage ?? Config.defaultLanguage,
      activationDate: { year: new Date().getFullYear(), month: new Date().getMonth() + 1, day: new Date().getDate() },
    };
  }

  private buildOrganization(id: number, user: UserInfo): Partial<Organization> {
    return {
      reference: this.reference(id, true),
      type: 'ORGANISATION',
      names: [user.organizationName],
      countriesOfResidence: [user.organizationCountry?.symbol?.toUpperCase() ?? Config.defaultCountry],
      structuredAddresses: [
        {
          type: 'BASIC',
          street: user.organizationStreet,
          houseNumber: user.organizationHouseNumber,
          zipCode: user.organizationZip,
          city: user.organizationLocation,
          countryCode: user.organizationCountry?.symbol?.toUpperCase() ?? Config.defaultCountry,
        },
      ],
    };
  }

  // --- NAME CHECK --- //
  async checkCustomer(id: number): Promise<RiskState> {
    await this.callApi<CheckResponse[]>('customers/check', 'POST', [this.reference(id)]);
    return this.getCheckResult(id);
  }

  async getCheckResult(id: number): Promise<RiskState> {
    const customerInfo = await this.getCustomerInfo(id);
    if (!customerInfo || customerInfo.lastCheckId < 0) return undefined;

    const customerCheckResult = await this.callApi<CheckResult>(
      `customers/checks/${customerInfo.lastCheckId}/result`,
      'GET',
    );
    return customerCheckResult.risks[0].categoryKey;
  }

  // --- DOCUMENTS --- //
  async getDocument(customerId: number, document: KycDocument, version: string, part: string): Promise<any> {
    return this.callApi<any>(
      `customers/${this.reference(customerId)}/documents/${document}/versions/${version}/parts/${part}`,
      'GET',
    );
  }

  async changeDocumentState(
    customerId: number,
    isOrganization: boolean,
    document: KycDocument,
    version: string,
    state: KycDocumentState,
  ): Promise<boolean> {
    const result = await this.callApi<string>(
      `customers/${this.reference(customerId, isOrganization)}/documents/${document}/versions/${version}/state`,
      'PUT',
      JSON.stringify(state),
    );

    return result === 'done';
  }

  async getDocumentVersions(customerId: number, document: KycDocument): Promise<DocumentVersion[]> {
    return this.callApi<DocumentVersion[]>(
      `customers/${this.reference(customerId)}/documents/${document}/versions`,
      'GET',
    );
  }

  async createDocumentVersion(
    customerId: number,
    isOrganization: boolean,
    document: KycDocument,
    version: string,
  ): Promise<boolean> {
    const data = {
      name: version,
    };
    const result = await this.callApi<string>(
      `customers/${this.reference(customerId, isOrganization)}/documents/${document}/versions/${version}`,
      'PUT',
      data,
    );
    return result === 'done';
  }

  async createDocumentVersionPart(
    customerId: number,
    isOrganization: boolean,
    document: KycDocument,
    version: string,
    part: string,
    fileName: string,
    contentType: KycContentType | string,
  ): Promise<boolean> {
    const data = {
      name: part,
      label: part,
      fileName: fileName,
      contentType: contentType,
    };
    const result = await this.callApi<string>(
      `customers/${this.reference(
        customerId,
        isOrganization,
      )}/documents/${document}/versions/${version}/parts/${part}/metadata`,
      'PUT',
      data,
    );
    return result === 'done';
  }

  async uploadDocument(
    customerId: number,
    isOrganization: boolean,
    document: KycDocument,
    version: string,
    part: string,
    contentType: KycContentType | string,
    data: any,
  ): Promise<boolean> {
    const result = await this.callApi<string>(
      `customers/${this.reference(customerId, isOrganization)}/documents/${document}/versions/${version}/parts/${part}`,
      'PUT',
      data,
      contentType,
    );

    return result === 'done';
  }

  // --- IDENTIFICATION --- //
  async initiateIdentification(id: number, sendMail: boolean, identType: KycDocument): Promise<InitiateResponse> {
    const data = {
      references: [this.reference(id)],
      sendInvitation: sendMail,
      overridingStyleInfo:
        identType === KycDocument.INITIATE_CHATBOT_IDENTIFICATION ? Config.kyc.chatbotStyle : undefined,
    };

    return await this.callApi<InitiateResponse[]>(`customers/initiate-${identType}-sessions`, 'POST', data).then(
      (r) => r[0],
    );
  }

  // --- HELPER METHODS --- //
  private reference(id: number, isOrganization = false): string {
    return isOrganization ? `${id}_organization` : `${id}`;
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
      const version = url.includes('initiate') ? '3.0.0' : this.baseVersion;
      return await this.http.request<T>({
        url: `${this.baseUrl}/${version}/${url}`,
        method: method,
        data: data,
        headers: {
          'Content-Type': contentType ?? 'application/json',
          'Session-Key': this.sessionKey,
        },
      });
    } catch (e) {
      if (nthTry > 1 && [403, 500].includes(e.response?.status)) {
        return this.request(url, method, data, contentType, nthTry - 1, e.response?.status === 403);
      }
      throw e;
    }
  }

  private async getNewSessionKey(): Promise<string> {
    // get the challenge
    const { key, challenge } = await this.http.get<Challenge>(`${this.baseUrl}/${this.baseVersion}/challenge`);

    // determine response
    const response = key + Config.kyc.mandator + Config.kyc.user + Config.kyc.password + challenge;
    const hash = createHash('sha1');
    hash.update(response);

    const data = {
      key: key,
      mandator: Config.kyc.mandator,
      user: Config.kyc.user,
      response: hash.digest('hex'),
    };

    // enable the session key
    await this.http.post(`${this.baseUrl}/${this.baseVersion}/authenticate`, data);

    return key;
  }
}
