import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Util } from 'src/shared/util';
import { SpiderDataRepository } from 'src/user/models/spider-data/spider-data.repository';
import { UserRepository } from 'src/user/models/user/user.repository';
import { KycInProgress, KycState, KycStatus, RiskState, UserData } from 'src/user/models/user-data/user-data.entity';
import {
  CreateResponse,
  Customer,
  KycDocument,
  KycContentType,
  KycDocumentState,
  KycDocuments,
  DocumentVersion,
  InitiateResponse,
  ChatbotResult,
} from './dto/kyc.dto';
import { KycApiService } from './kyc-api.service';
import { AccountType } from 'src/user/models/user-data/account-type.enum';

export enum KycProgress {
  ONGOING = 'Ongoing',
  COMPLETED = 'Completed',
  FAILED = 'Failed',
  EXPIRING = 'Expiring',
}

@Injectable()
export class KycService {
  private readonly defaultDocumentPart = 'content';

  constructor(
    private readonly userRepo: UserRepository,
    private readonly spiderDataRepo: SpiderDataRepository,
    private readonly kycApi: KycApiService,
  ) {}

  // --- CUSTOMER UPDATE --- //
  async createCustomer(userDataId: number, name: string): Promise<CreateResponse | undefined> {
    const customer = await this.kycApi.getCustomer(userDataId);
    if (!customer) {
      return this.kycApi.createCustomer(userDataId, name);
    }
  }

  async updateCustomer(userDataId: number, update: Partial<Customer>): Promise<void> {
    const customer = await this.kycApi.getCustomer(userDataId);
    if (customer) {
      Util.removeNullFields(update);
      await this.kycApi.updateCustomer({ ...customer, ...update });
    }
  }

  async initializeCustomer(user: UserData): Promise<void> {
    if (user.accountType === AccountType.PERSONAL) {
      await this.kycApi.updatePersonalCustomer(user.id, user);
    } else {
      await this.kycApi.updateOrganizationCustomer(user.id, user);
    }

    await this.uploadInitialCustomerInfo(user.id, user);
  }

  private async uploadInitialCustomerInfo(userDataId: number, user: UserData): Promise<void> {
    // check if info already exists
    const initialCustomerInfo = await this.kycApi.getDocument(
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
      onlyOwner: 'YES',
      authorisesConversationPartner: 'YES',
      businessActivity: {
        purposeBusinessRelationship: 'Kauf und Verkauf von DeFiChain Assets',
        employer: { address: 'TOKEN_PURCHASE' },
      },
      financialBackground: {
        liabilities: 'LESS_THAN_10000',
      },
    };

    await this.uploadDocument(
      userDataId,
      false,
      KycDocument.INITIAL_CUSTOMER_INFORMATION,
      'v1',
      'initial-customer-information.json',
      KycContentType.JSON,
      customerInfo,
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
      };

      await this.uploadDocument(
        userDataId,
        true,
        KycDocument.INITIAL_CUSTOMER_INFORMATION,
        'v1',
        'initial-customer-information.json',
        KycContentType.JSON,
        organizationInfo,
      );
    }
  }

  async uploadDocument(
    userDataId: number,
    isOrganization: boolean,
    document: KycDocument,
    version: string,
    fileName: string,
    contentType: KycContentType | string,
    data: any,
  ): Promise<boolean> {
    await this.kycApi.createDocumentVersion(userDataId, isOrganization, document, version);
    await this.kycApi.createDocumentVersionPart(
      userDataId,
      isOrganization,
      document,
      version,
      this.defaultDocumentPart,
      fileName,
      contentType,
    );
    const successful = await this.kycApi.uploadDocument(
      userDataId,
      isOrganization,
      document,
      version,
      this.defaultDocumentPart,
      contentType,
      data,
    );
    if (successful) {
      await this.kycApi.changeDocumentState(userDataId, isOrganization, document, version, KycDocumentState.COMPLETED);
    }

    return successful;
  }

  // --- NAME CHECK --- //
  async checkCustomer(id: number): Promise<RiskState | undefined> {
    return this.kycApi
      .checkCustomer(id)
      .then(() => this.kycApi.getCheckResult(id))
      .catch(() => undefined);
  }

  // --- KYC PROGRESS --- //
  async getKycProgress(userDataId: number, kycStatus: KycStatus): Promise<KycProgress> {
    const documentType = KycDocuments[kycStatus].document;
    const versions = await this.kycApi.getDocumentVersions(userDataId, false, documentType);
    if (!versions?.length) return KycProgress.ONGOING;

    // completed
    if (versions.find((doc) => doc.state === KycDocumentState.COMPLETED) != null) return KycProgress.COMPLETED;

    // failed
    if (versions.find((doc) => doc.state != KycDocumentState.FAILED && this.documentAge(doc) < Config.kyc.failAfterDays) == null)
      return KycProgress.FAILED;

    // expired
    if (
      this.documentAge(versions[0]) > Config.kyc.reminderAfterDays &&
      this.documentAge(versions[0]) < Config.kyc.failAfterDays
    ) {
      return KycProgress.EXPIRING;
    }

    return KycProgress.ONGOING;
  }

  async goToStatus(userData: UserData, status: KycStatus): Promise<UserData> {
    if (KycInProgress(status)) {
      const identType = KycDocuments[status].ident;
      const initiateData = await this.kycApi.initiateIdentification(userData.id, false, identType);
      userData.spiderData = await this.updateSpiderData(userData, initiateData);
    }

    return this.updateKycStatus(userData, status);
  }

  async chatbotCompleted(userData: UserData): Promise<UserData> {
    userData.riskState = await this.checkCustomer(userData.id);

    userData = await this.storeChatbotResult(userData);

    const vipUser = await this.userRepo.findOne({ where: { userData: { id: userData.id }, role: UserRole.VIP } });
    return vipUser
      ? await this.goToStatus(userData, KycStatus.VIDEO_ID)
      : await this.goToStatus(userData, KycStatus.ONLINE_ID);
  }

  async storeChatbotResult(userData: UserData): Promise<UserData> {
    try {
      const spiderData = userData.spiderData ?? (await this.spiderDataRepo.findOne({ userData: { id: userData.id } }));
      if (spiderData) {
        // get and store the result
        const chatbotResult = {
          person: await this.getChatbotResult(userData.id, false),
          organization:
            userData.accountType === AccountType.PERSONAL ? undefined : await this.getChatbotResult(userData.id, true),
        };

        spiderData.result = JSON.stringify(chatbotResult);
        userData.spiderData = await this.spiderDataRepo.save(spiderData);

        // update user data
        const result =
          userData.accountType === AccountType.PERSONAL ? chatbotResult.person : chatbotResult.organization;
        userData.contribution = +result.contribution;
        userData.plannedContribution = result.plannedDevelopmentOfAssets;
      }
    } catch (e) {
      console.error(`Failed to store chatbot result for user ${userData.id}:`, e);
    }

    return userData;
  }

  // --- HELPER METHODS --- //
  private documentAge(version: DocumentVersion) {
    return Util.daysDiff(new Date(version.creationTime), new Date());
  }

  private updateKycStatus(userData: UserData, status: KycStatus): UserData {
    console.log(`KYC change: status of user ${userData.id}: ${userData.kycStatus} -> ${status}`);

    userData.kycStatus = status;
    userData.kycState = KycState.NA;
    userData.kycStatusChangeDate = new Date();
    return userData;
  }

  updateKycState(userData: UserData, state: KycState): UserData {
    console.log(
      `KYC change: state of user ${userData.id} (${userData.kycStatus}): ${
        userData.kycState
      } -> ${state} (last change on ${userData.kycStatusChangeDate?.toLocaleString()})`,
    );

    userData.kycState = state;
    return userData;
  }

  private async updateSpiderData(userData: UserData, initiateData: InitiateResponse) {
    const spiderData =
      (await this.spiderDataRepo.findOne({ userData: { id: userData.id } })) ??
      this.spiderDataRepo.create({ userData: userData });

    const locator = initiateData.locators?.[0];
    if (!locator) {
      console.error(`Failed to initiate identification. Initiate result:`, initiateData);
      throw new ServiceUnavailableException('Identification initiation failed');
    }

    spiderData.url =
      locator.document === KycDocument.CHATBOT ? initiateData.sessionUrl + '&nc=true' : initiateData.sessionUrl;
    spiderData.secondUrl =
      locator.document === KycDocument.ONLINE_IDENTIFICATION
        ? await this.getOnlineIdLink(userData, locator.version)
        : null;

    return await this.spiderDataRepo.save(spiderData);
  }

  private async getOnlineIdLink(userData: UserData, version: string): Promise<string> {
    const onlineId = await this.kycApi.getDocument(
      userData.id,
      false,
      KycDocument.ONLINE_IDENTIFICATION,
      version,
      KycDocument.IDENTIFICATION_LOG,
    );
    return onlineId ? this.getOnlineIdUrl(onlineId.identificationId) : null;
  }

  private async getChatbotResult(userDataId: number, isOrganization: boolean): Promise<ChatbotResult> {
    // get the version of the completed chatbot document
    const versions = await this.kycApi.getDocumentVersions(
      userDataId,
      isOrganization,
      KycDocument.ADDITIONAL_INFORMATION,
    );
    const completedVersion = versions.find((u) => u.state == KycDocumentState.COMPLETED)?.name;

    return this.kycApi.getDocument(
      userDataId,
      isOrganization,
      KycDocument.ADDITIONAL_INFORMATION,
      completedVersion,
      this.defaultDocumentPart,
    );
  }

  // --- URLS --- //
  getDocumentUrl(kycCustomerId: number, document: KycDocument, version: string): string {
    return `https://kyc.eurospider.com/toolbox/rest/customer-resource/customer/${kycCustomerId}/doctype/${document}/version/${version}/part/${this.defaultDocumentPart}`;
  }

  getOnlineIdUrl(identificationId: string): string {
    return `https://go.${Config.kyc.prefix}online-ident.ch/app/dfxauto/identifications/${identificationId}/identification/start`;
  }
}
