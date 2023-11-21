import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Method, ResponseType } from 'axios';
import { createHash } from 'crypto';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { HttpError, HttpService } from '../../../../../shared/services/http.service';
import {
  Challenge,
  CheckResponse,
  CheckResult,
  CreateResponse,
  Customer,
  CustomerInformationResponse,
  DocumentInfo,
  DocumentVersion,
  DocumentVersionPart,
  InitiateResponse,
  KycContentType,
  KycDocument,
  KycDocumentState,
  KycRelationType,
  Organization,
  RiskResult,
  SubmitResponse,
} from './dto/spider.dto';

@Injectable()
export class SpiderApiService {
  private readonly logger = new DfxLogger(SpiderApiService);

  private readonly baseUrl = 'https://kyc.eurospider.com/kyc-v8-api/rest';
  private readonly baseVersion = '2.0.0';

  private sessionKey = 'session-key-will-be-updated';

  constructor(private readonly http: HttpService) {}

  // --- CUSTOMER --- //
  async getCustomer(id: number): Promise<Customer> {
    return this.callApi<Customer>(`customers/${this.reference(id)}`);
  }

  async getCustomerInfo(id: number): Promise<CustomerInformationResponse> {
    return this.callApi<CustomerInformationResponse>(`customers/${this.reference(id)}/information`);
  }

  async getChangedCustomers(modificationTime: number): Promise<string[]> {
    return this.callApi<string[]>(`customers?modificationTime=${modificationTime}`);
  }

  async createCustomer(id: number, name: string): Promise<CreateResponse | undefined> {
    const person = {
      contractReference: this.contract(id),
      customer: {
        reference: this.reference(id),
        type: 'PERSON',
        names: [{ lastName: name }],
        preferredLanguage: Config.defaultLanguage,
      },
    };

    return this.callApi<CreateResponse>('customers/contract-linked-list', 'POST', [person]);
  }

  async updateCustomer(customer: Customer): Promise<CreateResponse> {
    return this.callApi<CreateResponse>('customers/simple', 'POST', customer);
  }

  async updatePersonalCustomer(id: number, user: UserData): Promise<SubmitResponse[] | CreateResponse> {
    const customer = this.buildCustomer(id, user);

    // handle legacy customers without contract reference
    const customerInfo = await this.getCustomerInfo(id);
    if (!customerInfo || customerInfo.contractReference) {
      const person = {
        contractReference: this.contract(id),
        customer,
        relationTypes: [
          KycRelationType.CONVERSION_PARTNER,
          KycRelationType.BENEFICIAL_OWNER,
          KycRelationType.CONTRACTING_PARTNER,
        ],
      };

      return this.callApi<SubmitResponse[]>('customers/contract-linked-list', 'POST', [person]);
    } else {
      return this.callApi<CreateResponse>('customers/simple', 'POST', customer);
    }
  }

  async updateOrganizationCustomer(id: number, user: UserData): Promise<SubmitResponse[]> {
    const person = {
      contractReference: this.contract(id),
      customer: this.buildCustomer(id, user),
      relationTypes: [KycRelationType.CONVERSION_PARTNER, KycRelationType.CONTROLLER],
    };

    const organization = {
      contractReference: this.contract(id),
      customer: this.buildOrganization(id, user),
      relationTypes: [KycRelationType.CONTRACTING_PARTNER],
    };

    return this.callApi<SubmitResponse[]>('customers/contract-linked-list', 'POST', [person, organization]);
  }

  private buildCustomer(id: number, user: UserData): Partial<Customer> {
    const preferredLanguage = ['es', 'pt'].includes(user.language.symbol.toLowerCase())
      ? 'en'
      : user.language.symbol.toLowerCase();

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

  private buildOrganization(id: number, user: UserData): Partial<Organization> {
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

  async renameCustomerReference(oldReference: string, newReference: string): Promise<boolean> {
    const result = await this.callApi<string>(`customers/${oldReference}/rename?newReference=${newReference}`);
    return result === 'done';
  }

  async renameContractReference(oldReference: string, newReference: string): Promise<boolean> {
    const result = await this.callApi<string>(`contracts/${oldReference}/rename?newReference=${newReference}`);
    return result === 'done';
  }

  // --- NAME CHECK --- //
  async checkCustomer(id: number): Promise<CheckResponse[]> {
    return this.callApi<CheckResponse[]>('customers/check', 'POST', [this.reference(id)]);
  }

  async getCheckResult(id: number): Promise<RiskResult> {
    const customerInfo = await this.getCustomerInfo(id);
    if (!customerInfo || customerInfo.lastCheckId < 0) return { result: undefined, risks: [] };

    const customerCheckResult =
      customerInfo.lastCheckVerificationId < 0
        ? await this.callApi<CheckResult>(`customers/checks/${customerInfo.lastCheckId}/result/?detailed=true`)
        : await this.callApi<CheckResult>(
            `customers/checks/verifications/${customerInfo.lastCheckVerificationId}/result?detailed=true`,
          );

    return { result: customerCheckResult.risks[0].categoryKey, risks: customerCheckResult.risks };
  }

  // --- DOCUMENTS --- //
  async getDocumentInfos(customerId: number, isOrganization: boolean): Promise<DocumentInfo[]> {
    const { id: kycId } = await this.getCustomer(customerId);

    const documentList: DocumentInfo[] = [];

    const documents = (await this.getDocuments(customerId, isOrganization)) ?? [];
    for (const document of documents) {
      const versions = (await this.getDocumentVersions(customerId, isOrganization, document)) ?? [];
      for (const version of versions) {
        const parts = (await this.getDocumentVersionParts(customerId, isOrganization, document, version.name)) ?? [];

        documentList.push(
          ...parts.map((part) => ({
            document,
            version: version.name,
            part: part.name,
            state: version.state,
            creationTime: new Date(part.creationTime),
            modificationTime: new Date(part.modificationTime),
            label: part.label,
            fileName: part.fileName,
            contentType: part.contentType,
            url: this.getDocumentUrl(kycId, document, version.name, part.name),
          })),
        );
      }
    }

    return documentList;
  }

  async getDocuments(customerId: number, isOrganization: boolean): Promise<KycDocument[]> {
    return this.callApi(`customers/${this.reference(customerId, isOrganization)}/documents`);
  }

  async getBinaryDocument(
    customerId: number,
    isOrganization: boolean,
    document: KycDocument,
    version: string,
    part: string,
  ): Promise<Buffer> {
    return this.getDocument(customerId, isOrganization, document, version, part, 'arraybuffer').then(Buffer.from);
  }

  async getDocument<T>(
    customerId: number,
    isOrganization: boolean,
    document: KycDocument,
    version: string,
    part: string,
    responseType?: ResponseType,
  ): Promise<T> {
    return this.callApi<T>(
      `customers/${this.reference(customerId, isOrganization)}/documents/${document}/versions/${version}/parts/${part}`,
      'GET',
      undefined,
      undefined,
      responseType,
    );
  }

  async getCompletedDocument<T>(
    customerId: number,
    isOrganization: boolean,
    document: KycDocument,
    part: string,
  ): Promise<T> {
    const completedVersion = await this.getDocumentVersion(
      customerId,
      isOrganization,
      document,
      KycDocumentState.COMPLETED,
    );

    return this.getDocument(customerId, isOrganization, document, completedVersion?.name, part);
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

  async getDocumentVersions(
    customerId: number,
    isOrganization: boolean,
    document: KycDocument,
  ): Promise<DocumentVersion[]> {
    return this.callApi<DocumentVersion[]>(
      `customers/${this.reference(customerId, isOrganization)}/documents/${document}/versions`,
    );
  }

  async getDocumentVersion(
    customerId: number,
    isOrganization: boolean,
    document: KycDocument,
    state: KycDocumentState,
  ): Promise<DocumentVersion> {
    return this.getDocumentVersions(customerId, isOrganization, document).then((versions) =>
      versions?.find((v) => v?.state === state),
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

  async getDocumentVersionParts(
    customerId: number,
    isOrganization: boolean,
    document: KycDocument,
    version: string,
  ): Promise<DocumentVersionPart[]> {
    return this.callApi<DocumentVersionPart[]>(
      `customers/${this.reference(customerId, isOrganization)}/documents/${document}/versions/${version}/parts`,
    );
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

  getDocumentUrl(kycCustomerId: number, document: KycDocument, version: string, part: string): string {
    return `https://kyc.eurospider.com/toolbox/rest/customer-resource/customer/${kycCustomerId}/doctype/${document}/version/${version}/part/${part}`;
  }

  // --- IDENTIFICATION --- //
  async initiateIdentification(id: number, sendMail: boolean, identType: KycDocument): Promise<InitiateResponse> {
    const data = {
      references: [this.reference(id)],
      sendInvitation: sendMail,
      overridingStyleInfo:
        identType === KycDocument.INITIATE_CHATBOT_IDENTIFICATION ? Config.kycSpider.chatbotStyle : undefined,
    };

    return this.callApi<InitiateResponse[]>(`customers/initiate-${identType}-sessions`, 'POST', data).then((r) => r[0]);
  }

  // --- HELPER METHODS --- //
  private reference(id: number, isOrganization = false): string {
    return isOrganization ? `${id}_organization` : `${id}`;
  }

  private contract(id: number): string {
    return this.reference(id) + '_placeholder';
  }

  private async callApi<T>(
    url: string,
    method: Method = 'GET',
    data?: any,
    contentType?: string,
    responseType?: ResponseType,
  ): Promise<T> {
    return this.request<T>(url, method, data, contentType, responseType).catch((e: HttpError) => {
      if (e.response?.status === 404) {
        return null;
      }

      this.logger.verbose(`Error during Spider request ${method} ${url}: ${e.response?.status} ${e.response?.data}`);
      throw new ServiceUnavailableException({ status: e.response?.status, data: e.response?.data });
    });
  }

  private async request<T>(
    url: string,
    method: Method,
    data?: any,
    contentType?: string,
    responseType?: ResponseType,
    nthTry = 3,
    getNewKey = false,
  ): Promise<T> {
    try {
      if (getNewKey) this.sessionKey = await this.getNewSessionKey();
      const version = url.includes('initiate') || url.includes('rename') ? '3.0.0' : this.baseVersion;
      return await this.http.request<T>({
        url: `${this.baseUrl}/${version}/${url}`,
        method: method,
        data: data,
        responseType,
        headers: {
          'Content-Type': contentType ?? 'application/json',
          'Session-Key': this.sessionKey,
        },
      });
    } catch (e) {
      if (nthTry > 1 && [403, 500].includes(e.response?.status)) {
        return this.request(url, method, data, contentType, responseType, nthTry - 1, e.response?.status === 403);
      }
      throw e;
    }
  }

  private async getNewSessionKey(): Promise<string> {
    // get the challenge
    const { key, challenge } = await this.http.get<Challenge>(`${this.baseUrl}/${this.baseVersion}/challenge`);

    // determine response
    const response = key + Config.kycSpider.mandator + Config.kycSpider.user + Config.kycSpider.password + challenge;
    const hash = createHash('sha1');
    hash.update(response);

    const data = {
      key: key,
      mandator: Config.kycSpider.mandator,
      user: Config.kycSpider.user,
      response: hash.digest('hex'),
    };

    // enable the session key
    await this.http.post(`${this.baseUrl}/${this.baseVersion}/authenticate`, data);

    return key;
  }
}
