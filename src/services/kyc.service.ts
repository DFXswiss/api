import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Method } from 'axios';
import { createHash } from 'crypto';
import { User } from 'src/user/user.entity';
import { KycStatus, UserData } from 'src/userData/userData.entity';
import { UserDataRepository } from 'src/userData/userData.repository';
import { HttpService } from './http.service';
import { MailService } from './mail.service';

export enum State {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum KycDocument {
  CHATBOT = 'chatbot-onboarding',
  ADDITIONAL_INFORMATION = 'additional-information',
  ADDRESS_CHECK = 'address-check',
  API_CHECK = 'api-check',
  API_UPLOAD_FINANCIAL_STATEMENT = 'api-upload-financial-statement',
  API_UPLOAD_IDENTIFICATION_DOCUMENT = 'api-upload-identification-document',
  APPROVAL_DOCUMENT = 'approval-document',
  BCP = 'bcp',
  BENEFICIAL_OWNER = 'beneficial-owner',
  CERTIFICATE_INHERITANCE = 'certificate-inheritance',
  CHATBOT_ONBOARDING = 'chatbot-onboarding',
  CHATBOT_VERIFICATION = 'chatbot-verification',
  CHECK = 'check',
  COMPLIANCE_CHECK = 'compliance-desk',
  CONTROLLER = 'controller',
  CRYPTO_CURRENCY_PROPERTIES = 'crypto-currency-properties',
  EDD = 'edd',
  FINANCIAL_STATEMENTS = 'financial-statements',
  INCORPORATION_CERTIFICATE = 'incorporation_certificate',
  INVOICE = 'invoice',
  MRZ = 'mrz',
  ONLINE_IDENTIFICATION = 'online-identification',
  PASSPORT_OR_ID = 'passport_or_id',
  REGISTRY_COMMERCE = 'registry_commerce',
  REPRESENTATION = 'representation',
  STATUTES_ASSOCIATION = 'statutes-association',
  TAX_DECLARATION = 'tax-declaration',
  USER_ADDED_DOCUMENT = 'user-added-document',
  VERIFICATION = 'verification',
  VIDEO_IDENTIFICATION = 'video_identification',
}

interface Challenge {
  key: string;
  challenge: string;
}

interface CheckResponse {
  customerReference: string;
  customerId: number;
  customerVersionId: number;
  checkId: number;
  checkTime: number;
  riskState: string;
}

interface CreateResponse {
  customerReference: string;
  customerId: number;
  customerVersionId: number;
}

interface ChatBotResponse {
  document: string;
  reference: string;
  sessionUrl: string;
  version: string;
}

interface IdentificationResponse {
  document: string;
  reference: string;
  version: string;
}

export interface CheckVersion {
  name: string;
  state: State;
  creationTime: number;
  modificationTime: number;
}

export interface CheckResult {
  checkId: number;
  checkTime: number;
  matchIds: number[];
  risks: Risk[];
}

interface Risk {
  criterionKey: string;
  categoryKey: string;
}

export interface CustomerResponse {
  id: number;
  versionId: number;
  reference: string;
  emails: [string];
  structuredAddresses: [
    {
      street: string;
      houseNumber: string;
      zipCode: string;
      city: string;
      countryCode: string;
    },
  ];
  telephones: [string];
  countriesOfResidence: [string];
  preferredLanguage: string;
  activationDate: { year: string; month: string; day: string };
  deactivationDate: { year: string; month: string; day: string };
  gender: string;
  title: string;
  names: [{ firstName: string; lastName: string }];
  datesOfBirth: [{ year: string; month: string; day: string }];
  placesOfBirth: [{ year: string; month: string; day: string }];
  citizenships: [string];
}

export interface Customer {
  reference: number;
  type: string;
  id?: number;
  versionId?: number;
  names: [{ firstName: string; lastName: string }];
  datesOfBirth: [{ year: string; month: string; day: string }];
  citizenships: [string];
  countriesOfResidence: [string];
  emails: [string];
  telephones: [string];
  structuredAddresses: [
    {
      street: string;
      houseNumber: string;
      zipCode: string;
      city: string;
      countryCode: string;
    },
  ];
  gender: string;
  title: string;
  preferredLanguage: string;
  activationDate: { year: string; month: string; day: string };
  deactivationDate: { year: string; month: string; day: string };
}

interface CustomerInformationResponse {
  reference: string;
  contractReference: string;
  contractState: string;
  lastCheckId: number;
  lastCheckTime: number;
  lastCheckVerificationId: number;
}

@Injectable()
export class KycService {
  private baseUrl = 'https://kyc.eurospider.com/kyc-v8-api/rest/2.0.0';

  constructor(
    private http: HttpService,
    private userDataRepository: UserDataRepository,
    private mailService: MailService,
  ) {}

  async createCustomer(id: number, name: string): Promise<CreateResponse> {
    const data = {
      reference: this.reference(id),
      type: 'PERSON',
      names: [{ lastName: name }],
    };

    try {
      return await this.callApi<CreateResponse>('customers/simple', 'POST', data);
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to register KYC customer');
    }
  }

  async updateCustomer(id: number, user: User): Promise<CreateResponse> {
    const data = {
      reference: this.reference(id),
      type: 'PERSON',
      names: [{ firstName: user.firstname, lastName: user.surname }],
      countriesOfResidence: [user.country.symbol],
      emails: [user.mail],
      telephones: [user.phone.replace('+', '').replace(' ', '')],
      structuredAddresses: [
        {
          type: 'BASIC',
          street: user.street,
          houseNumber: user.houseNumber,
          zipCode: user.zip,
          city: user.location,
          countryCode: user.country.symbol,
        },
      ],
      preferredLanguage: user.language?.symbol.toLowerCase() ?? 'de',
      activationDate: { year: new Date().getFullYear(), month: new Date().getMonth() + 1, day: new Date().getDate() },
    };

    try {
      return await this.callApi<CreateResponse>('customers/simple', 'POST', data);
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to update KYC customer');
    }
  }
  async getAllCustomer(): Promise<string[]> {
    try {
      return await this.callApi<string[]>(`customers`, 'GET');
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to get KYC customer');
    }
  }

  async getCustomer(id: number): Promise<Customer> {
    try {
      return await this.callApi<Customer>(`customers/${this.reference(id)}`, 'GET');
    } catch (e) {
      if (e.response.status === 404) {
        return null;
      }
      console.log(e);
      throw new ServiceUnavailableException('Failed to get KYC customer');
    }
  }

  async getCustomerInformation(id: number): Promise<CustomerInformationResponse> {
    try {
      return await this.callApi<CustomerInformationResponse>(`customers/${this.reference(id)}/information`, 'GET');
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to get KYC customer');
    }
  }

  async getCheckResult(customerCheckId: number): Promise<CheckResult> {
    try {
      return await this.callApi<CheckResult>(`customers/checks/${customerCheckId}/result`, 'GET');
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to get check result');
    }
  }

  async getDocuments(id: number): Promise<CheckResult> {
    try {
      return await this.callApi<any>(`customers/${this.reference(id)}/documents?`, 'GET');
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to get documents');
    }
  }

  async checkCustomer(id: number): Promise<CheckResponse> {
    try {
      const results = await this.callApi<CheckResponse[]>('customers/check', 'POST', [this.reference(id)]);
      return results[0];
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to do name check');
    }
  }

  async initiateOnboardingChatBot(id: number): Promise<ChatBotResponse> {
    const data = {
      references: [this.reference(id)],
      sendingInvitation: true,
    };

    try {
      const result = await this.callApi<ChatBotResponse[]>(
        'customers/initiate-onboarding-chatbot-sessions',
        'POST',
        data,
      );
      return result[0];
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to onboard chatbot for customer');
    }
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

    try {
      const result = await this.callApi<any>('customers/contract-linked', 'POST', data);
      return result[0];
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to create file reference');
    }
  }

  async initiateOnlineIdentification(id: number): Promise<IdentificationResponse> {
    try {
      const result = await this.callApi<any>('customers/initiate-online-identifications', 'POST', [this.reference(id)]);
      return result[0];
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to initiate online identification');
    }
  }

  async initiateDocumentUpload(id: number, kycDocuments: KycDocument[]): Promise<IdentificationResponse> {
    try {
      const query: string = this.getUploadDocumentQuery(kycDocuments);

      const result = await this.callApi<IdentificationResponse[]>(
        `customers/initiate-document-uploads?${query}`,
        'POST',
        [this.reference(id)],
      );
      return result[0];
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to initiate upload document');
    }
  }

  async uploadDocument(id: number, kycDocumentVersion: string, kycDocument: KycDocument): Promise<boolean> {
    try {
      //TODO BODY with PDF rawData

      var fs = require('fs');
      const image = fs.readFileSync('D:/Projects/api-fiat2defi/src/services/ident.jpg');

      const result = await this.callApi<string>(
        `customers/${this.reference(
          id,
        )}/documents/${kycDocument}/versions/${kycDocumentVersion}/parts/${kycDocumentVersion}`,
        'PUT',
        image,
        'image/jpeg',
      );

      return result === 'done';
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to initiate upload document');
    }
  }

  getUploadDocumentQuery(queryArray: KycDocument[]): string {
    let resultString: string = '';
    queryArray.forEach((a) => (resultString += 'documentName=' + a + '&'));
    return resultString.slice(0, -1);
  }

  async getDocumentVersion(id: number, document: KycDocument): Promise<CheckVersion> {
    try {
      const result = await this.callApi<CheckVersion[]>(
        `customers/${this.reference(id)}/documents/${document}/versions`,
        'GET',
      );
      return result[result.length - 1];
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to get document version');
    }
  }

  async createDocumentVersion(id: number, document: KycDocument, version: string): Promise<boolean> {
    try {
      const data = {
        name: 'ident2',
        state: 'PENDING',
      };

      const result = await this.callApi<string>(
        `customers/${this.reference(id)}/documents/${document}/versions/${version}`,
        'PUT',
        data,
      );
      return result === 'done';
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to create a document version part');
    }
  }

  async createDocumentVersionPart(id: number, document: string, version: string, part: string): Promise<boolean> {
    try {
      const data = {
        name: 'ident2',
        label: 'ident2',
        fileName: 'ident.img',
        contentType: 'image/jpeg',
      };

      const result = await this.callApi<string>(
        `customers/${this.reference(id)}/documents/${document}/versions/${version}/parts/${part}/metadata`,
        'PUT',
        data,
      );
      return result === 'done';
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to create a document version');
    }
  }

  async doChatBotCheck(): Promise<void> {
    await this.doCheck(KycStatus.WAIT_CHAT_BOT, KycStatus.WAIT_ADDRESS, KycDocument.CHATBOT, async (userData) => {
      const customerInformation = await this.getCustomerInformation(userData.id);
      const resultNameCheck = await this.getCheckResult(customerInformation.lastCheckId);
      if (resultNameCheck.risks[0].categoryKey === 'a' || resultNameCheck.risks[0].categoryKey === 'b') {
        await this.checkCustomer(userData.id);
      }
      await this.initiateDocumentUpload(userData.id, [KycDocument.INVOICE]);
      return userData;
    });
  }

  async doAddressCheck(): Promise<void> {
    await this.doCheck(KycStatus.WAIT_ADDRESS, KycStatus.WAIT_ONLINE_ID, KycDocument.INVOICE, async (userData) => {
      await this.initiateOnlineIdentification(userData.id);
      return userData;
    });
  }

  async doOnlineIdCheck(): Promise<void> {
    await this.doCheck(
      KycStatus.WAIT_ONLINE_ID,
      KycStatus.WAIT_MANUAL,
      KycDocument.ONLINE_IDENTIFICATION,
      async (userData, document) => {
        await this.mailService.sendKycRequestMail(userData, document);
        return userData;
      },
    );
  }

  // --- HELPER METHODS --- //
  private reference(id: number): string {
    return process.env.KYC_PREFIX ? `${process.env.KYC_PREFIX}${id}` : id.toString();
  }

  private async doCheck(
    currentStatus: KycStatus,
    nextStatus: KycStatus,
    documentType: KycDocument,
    updateAction: (userData: UserData, documentVersion: CheckVersion) => Promise<UserData>,
  ): Promise<void> {
    const userDataList = await this.userDataRepository.find({ kycStatus: currentStatus });
    for (const key in userDataList) {
      const documentVersion = await this.getDocumentVersion(userDataList[key].id, documentType);
      if (documentVersion.state == State.COMPLETED) {
        userDataList[key].kycStatus = nextStatus;
        userDataList[key] = await updateAction(userDataList[key], documentVersion);
      }
    }
    await this.userDataRepository.save(userDataList);
  }

  private async callApi<T>(url: string, method: Method, data?: any, contentType?: any): Promise<T> {
    const sessionKey = await this.getSessionKey();
    return this.http.request<T>({
      url: `${this.baseUrl}/${url}`,
      method: method,
      data: data,
      headers: {
        'Content-Type': contentType ?? 'application/json',
        'Session-Key': sessionKey,
      },
    });
  }

  private async getSessionKey(): Promise<string> {
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
