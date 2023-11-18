import { Injectable } from '@nestjs/common';
import { ClientRequest } from 'http';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import {
  ChatbotExport,
  ChatbotResult,
  CreateResponse,
  Customer,
  DocumentVersion,
  IdentificationLog,
  InitiateResponse,
  KycContentType,
  KycDocument,
  KycDocumentState,
  RiskResult,
} from './dto/spider.dto';
import { SpiderApiService } from './spider-api.service';

export enum DocumentState {
  ONGOING = 'Ongoing',
  COMPLETED = 'Completed',
  FAILED = 'Failed',
  EXPIRING = 'Expiring',
}

export enum ReferenceType {
  CUSTOMER = 'customer',
  CONTRACT = 'contract',
}

@Injectable()
export class SpiderService {
  private readonly defaultDocumentPart = 'content';

  constructor(private readonly spiderApi: SpiderApiService, private readonly http: HttpService) {}

  // --- CUSTOMER UPDATE --- //
  async createCustomer(userDataId: number, name: string): Promise<CreateResponse | undefined> {
    const customer = await this.spiderApi.getCustomer(userDataId);
    if (!customer) {
      return this.spiderApi.createCustomer(userDataId, name);
    }
  }

  async updateCustomer(userDataId: number, update: Partial<Customer>): Promise<void> {
    const customer = await this.spiderApi.getCustomer(userDataId);
    if (customer) {
      // remove empty names
      customer.names = customer.names.filter((n) => n.firstName !== '' || n.lastName !== '');

      Util.removeNullFields(update);
      await this.spiderApi.updateCustomer({ ...customer, ...update });
    }
  }

  public async renameReference(
    oldReference: string,
    newReference: string,
    referenceType: ReferenceType,
  ): Promise<boolean> {
    return referenceType == ReferenceType.CONTRACT
      ? this.spiderApi.renameContractReference(oldReference, newReference)
      : this.spiderApi.renameCustomerReference(oldReference, newReference);
  }

  async initializeCustomer(user: UserData): Promise<void> {
    if (user.accountType === AccountType.PERSONAL) {
      await this.spiderApi.updatePersonalCustomer(user.id, user);
    } else {
      await this.spiderApi.updateOrganizationCustomer(user.id, user);
    }

    await this.uploadInitialCustomerInfo(user.id, user);
  }

  private async uploadInitialCustomerInfo(userDataId: number, user: UserData): Promise<void> {
    // check if info already exists
    const initialCustomerInfo = await this.spiderApi.getDocument(
      userDataId,
      false,
      KycDocument.INITIAL_CUSTOMER_INFORMATION,
      'v1',
      this.defaultDocumentPart,
    );
    if (initialCustomerInfo) return;

    // pre-fill customer info
    const customerInfo = {
      type: 'AdditionalPersonInformation',
      nickName: user.firstname,
      onlyOwner: user.accountType === AccountType.BUSINESS ? undefined : 'YES',
      authorisesConversationPartner: user.accountType === AccountType.BUSINESS ? undefined : 'YES',
      contribution: '0',
      businessActivity: {
        purposeBusinessRelationship: 'Kauf und Verkauf von DeFiChain Assets',
        employer: { address: 'n.a.' },
        jobFunction: 'n.a.',
      },
      financialBackground: {
        liabilities: 'LESS_THAN_10000',
      },
    };

    await this.uploadDocument(
      userDataId,
      false,
      KycDocument.INITIAL_CUSTOMER_INFORMATION,
      'initial-customer-information.json',
      KycContentType.JSON,
      customerInfo,
      'v1',
    );

    // pre-fill organization info
    if (user.accountType !== AccountType.PERSONAL) {
      const organizationInfo = {
        type:
          user.accountType === AccountType.SOLE_PROPRIETORSHIP
            ? 'AdditionalOrganisationInformation'
            : 'AdditionalLegalEntityInformation',
        organisationType: user.accountType === AccountType.SOLE_PROPRIETORSHIP ? 'SOLE_PROPRIETORSHIP' : 'LEGAL_ENTITY',
        purposeBusinessRelationship: 'Kauf und Verkauf von DeFiChain Assets',
        bearerShares: 'NO',
        contribution: '0',
      };

      await this.uploadDocument(
        userDataId,
        true,
        KycDocument.INITIAL_CUSTOMER_INFORMATION,
        'initial-customer-information.json',
        KycContentType.JSON,
        organizationInfo,
        'v1',
      );
    }
  }

  async uploadDocument(
    userDataId: number,
    isOrganization: boolean,
    document: KycDocument,
    fileName: string,
    contentType: KycContentType | string,
    data: any,
    version: string = Date.now().toString(),
  ): Promise<boolean> {
    await this.spiderApi.createDocumentVersion(userDataId, isOrganization, document, version);
    await this.spiderApi.createDocumentVersionPart(
      userDataId,
      isOrganization,
      document,
      version,
      this.defaultDocumentPart,
      fileName,
      contentType,
    );
    const successful = await this.spiderApi.uploadDocument(
      userDataId,
      isOrganization,
      document,
      version,
      this.defaultDocumentPart,
      contentType,
      data,
    );
    if (successful) {
      await this.spiderApi.changeDocumentState(
        userDataId,
        isOrganization,
        document,
        version,
        KycDocumentState.COMPLETED,
      );
    }

    return successful;
  }

  // --- NAME CHECK --- //
  async checkCustomer(id: number): Promise<RiskResult> {
    return this.spiderApi
      .checkCustomer(id)
      .then(() => this.spiderApi.getCheckResult(id))
      .catch(() => undefined);
  }

  // --- KYC --- //
  async getDocumentState(userDataId: number, documentType: KycDocument): Promise<DocumentState> {
    const versions = await this.spiderApi.getDocumentVersions(userDataId, false, documentType);
    if (!versions?.length) return DocumentState.ONGOING;

    // completed
    if (versions.find((doc) => doc.state === KycDocumentState.COMPLETED) != null) return DocumentState.COMPLETED;

    // failed
    if (
      versions.find(
        (doc) => doc.state != KycDocumentState.FAILED && this.documentAge(doc) < Config.kycSpider.failAfterDays,
      ) == null
    )
      return DocumentState.FAILED;

    // expired
    if (
      this.documentAge(versions[0]) > Config.kycSpider.reminderAfterDays &&
      this.documentAge(versions[0]) < Config.kycSpider.failAfterDays
    ) {
      return DocumentState.EXPIRING;
    }

    return DocumentState.ONGOING;
  }

  async initiateIdentification(userDataId: number, identType: KycDocument): Promise<InitiateResponse> {
    return this.spiderApi.initiateIdentification(userDataId, false, identType);
  }

  async getChatbotResult(userDataId: number, isOrganization: boolean): Promise<ChatbotResult> {
    return this.spiderApi.getCompletedDocument<ChatbotResult>(
      userDataId,
      isOrganization,
      KycDocument.ADDITIONAL_INFORMATION,
      this.defaultDocumentPart,
    );
  }

  async getChatbotExport(userDataId: number, isOrganization: boolean): Promise<ChatbotExport> {
    return this.spiderApi.getCompletedDocument<ChatbotExport>(
      userDataId,
      isOrganization,
      KycDocument.CHATBOT_ONBOARDING,
      'export',
    );
  }

  async getOnlineIdLog(userData: UserData, version: string): Promise<IdentificationLog | undefined> {
    return this.spiderApi.getDocument<IdentificationLog>(
      userData.id,
      false,
      KycDocument.ONLINE_IDENTIFICATION,
      version,
      KycDocument.IDENTIFICATION_LOG,
    );
  }

  async getVideoIdentificationId(sessionUrl: string): Promise<string> {
    const request = await this.http.getRaw(sessionUrl).then((r) => r.request as ClientRequest);
    return request.path.substring(request.path.lastIndexOf('/') + 1);
  }

  // --- URLS --- //
  getDocumentUrl(
    kycCustomerId: number,
    document: KycDocument,
    version: string,
    part: string = this.defaultDocumentPart,
  ): string {
    return this.spiderApi.getDocumentUrl(kycCustomerId, document, version, part);
  }

  getOnlineIdUrl(identificationId: string): string {
    return `https://go.${Config.kycSpider.prefix}online-ident.ch/app/dfxauto/identifications/${identificationId}/identification/start`;
  }

  // --- HELPER METHODS --- //
  private documentAge(version: DocumentVersion) {
    return Util.daysDiff(new Date(version.creationTime), new Date());
  }
}
