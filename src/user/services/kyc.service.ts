import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Method } from 'axios';
import { createHash } from 'crypto';
import { User } from 'src/user/models/user/user.entity';
import { KycFile } from 'src/user/models/userData/kycFile.entity';
import { KycState, KycStatus, UserData } from 'src/user/models/userData/userData.entity';
import { UserDataRepository } from 'src/user/models/userData/userData.repository';
import { Not, Repository } from 'typeorm';
import { HttpError, HttpService } from '../../shared/services/http.service';
import { MailService } from '../../shared/services/mail.service';
import { UserRepository } from '../models/user/user.repository';

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
  private readonly baseUrl = 'https://kyc.eurospider.com/kyc-v8-api/rest/2.0.0';

  private sessionKey = 'session-key-will-be-updated';

  constructor(
    private http: HttpService,
    private mailService: MailService,
    @InjectRepository(KycFile)
    private kycFileRepo: Repository<KycFile>,
    private userDataRepository: UserDataRepository,
    private userRepository: UserRepository,
  ) {}

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

    return this.callApi<CreateResponse>('customers/simple', 'POST', data);
  }
  async getAllCustomer(): Promise<string[]> {
    return this.callApi<string[]>(`customers`, 'GET');
  }

  async getCustomer(id: number): Promise<Customer> {
    return await this.callApi<Customer>(`customers/${this.reference(id)}`, 'GET');
  }

  async getCustomerInformation(id: number): Promise<CustomerInformationResponse> {
    return this.callApi<CustomerInformationResponse>(`customers/${this.reference(id)}/information`, 'GET');
  }

  async getCheckResult(customerCheckId: number): Promise<CheckResult> {
    return this.callApi<CheckResult>(`customers/checks/${customerCheckId}/result`, 'GET');
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
    await this.doCheck(KycStatus.WAIT_ONLINE_ID, KycStatus.WAIT_MANUAL, KycDocument.ONLINE_IDENTIFICATION, (u) =>
      this.createKycFile(u),
    );
  }

  async doVideoIdentCheck(): Promise<void> {
    await this.doCheck(KycStatus.WAIT_ONLINE_ID, KycStatus.WAIT_MANUAL, KycDocument.VIDEO_IDENTIFICATION, (u) =>
      this.createKycFile(u),
    );
  }

  private async createKycFile(userData: UserData): Promise<UserData> {
    // create KYC file reference
    const kycFile = await this.kycFileRepo.save({ userData: userData });
    const user = await this.userRepository.findOne({ where: { mail: Not('') }, relations: ['userData'] });

    userData.kycFile = kycFile;

    //TODO: upload KYC file reference
    //await this.kycService.createFileReference(userData.id, userData.kycFileReference, user.surname);

    await this.mailService.sendKycMail(userData, user, (await this.getCustomer(userData.id)).id);
    return userData;
  }

  // --- HELPER METHODS --- //
  private reference(id: number): string {
    return process.env.KYC_PREFIX ? `${process.env.KYC_PREFIX}${id}` : id.toString();
  }

  private async doCheck(
    currentStatus: KycStatus,
    nextStatus: KycStatus,
    documentType: KycDocument,
    updateAction: (userData: UserData) => Promise<UserData>,
  ): Promise<void> {
    const userDataList = await this.userDataRepository.find({
      where: { kycStatus: currentStatus },
    });
    for (const key in userDataList) {
      const documentVersions = await this.getDocumentVersion(userDataList[key].id, documentType);
      if (!documentVersions?.length) continue;

      const isCompleted = documentVersions.find((document) => document.state === State.COMPLETED) != null;
      const isFailed =
        documentVersions.find(
          (document) => document.state != State.FAILED && this.dateDiffInDays(document.creationTime) < 7,
        ) == null;
      const shouldBeReminded =
        !isFailed &&
        this.dateDiffInDays(documentVersions[0].creationTime) > 2 &&
        this.dateDiffInDays(documentVersions[0].creationTime) < 7;

      if (isCompleted) {
        userDataList[key].kycStatus = nextStatus;
        userDataList[key].kycState = KycState.PENDING;
        userDataList[key] = await updateAction(userDataList[key]);
      } else if (isFailed && userDataList[key].kycState != KycState.FAILED) {
        userDataList[key].kycState = KycState.FAILED;
        const customer = await this.getCustomer(userDataList[key].id);
        await this.mailService.sendSupportFailedMail(userDataList[key], customer.id);
      } else if (shouldBeReminded && userDataList[key].kycState != KycState.REMINDED) {
        const user = await this.userRepository.findOne({ where: { mail: Not('') }, relations: ['userData'] });
        await this.mailService.sendReminderMail(user, currentStatus);
        userDataList[key].kycState = KycState.REMINDED;
      }
    }
    await this.userDataRepository.save(userDataList);
  }

  private async callApi<T>(url: string, method: Method, data?: any, contentType?: any): Promise<T> {
    return this.request<T>(this.sessionKey, url, method, data, contentType)
      .catch((e: HttpError) => {
        if (e.response?.status === 403) {
          return this.getNewSessionKey().then((key) => {
            this.sessionKey = key;
            return this.request<T>(key, url, method, data, contentType);
          });
        }
        throw e;
      })
      .catch((e: HttpError) => {
        if (e.response?.status === 404) {
          return null;
        }

        throw new ServiceUnavailableException(e);
      });
  }

  private async request<T>(sessionKey: string, url: string, method: Method, data?: any, contentType?: any): Promise<T> {
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

  private dateDiffInDays(creationTime: number) {
    const timeDiff = new Date().getTime() - new Date(creationTime).getTime();
    return timeDiff / (1000 * 3600 * 24);
  }
}
