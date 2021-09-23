import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Method } from 'axios';
import { createHash } from 'crypto';
import { User } from 'src/user/user.entity';
import { KycStatus } from 'src/userData/userData.entity';
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
      reference: id.toString(),
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
      reference: id.toString(),
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

  async getCustomer(id: number): Promise<CustomerResponse> {
    try {
      return await this.callApi<CustomerResponse>(`customers/${id.toString()}`, 'GET');
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
      return await this.callApi<CustomerInformationResponse>(`customers/${id.toString()}/information`, 'GET');
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to get KYC customer');
    }
  }

  async getCheckResult(customerCheckId: number): Promise<CheckResult> {
    try {
      return await this.callApi<CheckResult>(`customers/checks/${customerCheckId.toString()}/result`, 'GET');
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to do get check result');
    }
  }

  async checkCustomer(id: number): Promise<CheckResponse> {
    try {
      const results = await this.callApi<CheckResponse[]>('customers/check', 'POST', [id.toString()]);
      return results[0];
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to do name check');
    }
  }

  async onboardingCustomer(id: number): Promise<ChatBotResponse> {
    const data = {
      references: [id.toString()],
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

  async onlineIdentificationCustomer(id: number): Promise<IdentificationResponse> {
    try {
      const result = await this.callApi<IdentificationResponse[]>(
        'customers/initiate-online-identifications',
        'POST',
        id.toString(),
      );
      return result[0];
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to initiate online identification');
    }
  }

  async documentUploadCustomer(id: number): Promise<IdentificationResponse> {
    try {
      const query: string = await this.getUploadDocumentQuery(['passport_or_id', 'invoice', 'representation']);

      const result = await this.callApi<IdentificationResponse[]>(
        `customers/initiate-online-identifications?${query}`,
        'POST',
        id.toString(),
      );
      return result[0];
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to initiate upload document');
    }
  }

  async getUploadDocumentQuery(queryArray: string[]): Promise<string> {
    let resultString: string = '';
    queryArray.forEach((a) => (resultString += 'documentName=' + a + '?'));
    return resultString.slice(0, -1);
  }

  async getDocumentVersions(id: number, document: string): Promise<CheckVersion> {
    try {
      const result = await this.callApi<CheckVersion[]>(
        `customers/${id.toString()}/documents/${document}/versions`,
        'GET',
      );
      return result[result.length - 1];
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to onboard chatbot for customer');
    }
  }

  async chatBotCheck(): Promise<void> {
    const userData = await this.userDataRepository.find({ kycStatus: KycStatus.WAIT_CHAT_BOT });
    for (const key in userData) {
      const chatBotState = await this.getDocumentVersions(userData[key].id, KycDocument.CHATBOT);
      if (chatBotState.state == State.COMPLETED) {
        userData[key].kycStatus = KycStatus.WAIT_VERIFY_ADDRESS;
        const customerInformation = await this.getCustomerInformation(userData[key].id);
        const resultNameCheck = await this.getCheckResult(customerInformation.lastCheckId);
        if (resultNameCheck.risks[0].categoryKey === 'a' || resultNameCheck.risks[0].categoryKey === 'b')
          await this.checkCustomer(userData[key].id);
        this.mailService.sendKycRequestMail(userData[key], chatBotState);
      }
    }
    await this.userDataRepository.save(userData);
  }

  // --- HELPER METHODS --- //
  private async callApi<T>(url: string, method: Method, data?: any, params?: any): Promise<T> {
    const sessionKey = await this.getSessionKey();
    return this.http.request<T>({
      url: `${this.baseUrl}/${url}`,
      method: method,
      data: data,
      headers: {
        'Content-Type': 'application/json',
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
