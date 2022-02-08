import { Injectable } from '@nestjs/common';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Util } from 'src/shared/util';
import { SpiderDataRepository } from 'src/user/models/spider-data/spider-data.repository';
import { UserInfo } from 'src/user/models/user/user.entity';
import { UserRepository } from 'src/user/models/user/user.repository';
import { AccountType } from 'src/user/models/userData/account-type.enum';
import { KycState, KycStatus, UserData } from 'src/user/models/userData/userData.entity';
import { KycDocument, KycContentType, KycDocumentState, InitiateResponse, DocumentVersion } from './dto/kyc.dto';
import { KycApiService } from './kyc-api.service';

export enum KycProgress {
  ONGOING = 'Ongoing',
  COMPLETED = 'Completed',
  FAILED = 'Failed',
  EXPIRING = 'Expiring',
}

@Injectable()
export class KycService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly spiderDataRepo: SpiderDataRepository,
    private readonly kycApi: KycApiService,
  ) {}

  // --- CUSTOMER UPDATE --- //
  public async updateCustomer(userDataId: number, userInfo: UserInfo): Promise<void> {
    if (userInfo.accountType === AccountType.PERSONAL) {
      await this.kycApi.updatePersonalCustomer(userDataId, userInfo);
    } else {
      await this.kycApi.updateOrganizationCustomer(userDataId, userInfo);
    }

    await this.uploadInitialCustomerInfo(userDataId, userInfo);
  }

  private async uploadInitialCustomerInfo(userDataId: number, userInfo: UserInfo): Promise<void> {
    // check if info already exists
    const initialCustomerInfo = await this.kycApi.getDocument(
      userDataId,
      KycDocument.INITIAL_CUSTOMER_INFORMATION,
      'v1',
      'content',
    );
    if (initialCustomerInfo) return;

    // pre-fill customer info
    const customerInfo = {
      type: 'AdditionalPersonInformation',
      nickName: userInfo.firstname,
      onlyOwner: 'YES',
      authorisesConversationPartner: 'YES',
      businessActivity: {
        purposeBusinessRelationship: 'Kauf und Verkauf von DeFiChain Assets',
      },
    };

    await this.uploadDocument(
      userDataId,
      false,
      KycDocument.INITIAL_CUSTOMER_INFORMATION,
      'v1',
      'content',
      'initial-customer-information.json',
      KycContentType.JSON,
      customerInfo,
    );

    // pre-fill organization info
    if (userInfo.accountType !== AccountType.PERSONAL) {
      const organizationInfo = {
        type:
          userInfo.accountType === AccountType.SOLE_PROPRIETORSHIP
            ? 'AdditionalOrganisationInformation'
            : 'AdditionalLegalEntityInformation',
        organisationType:
          userInfo.accountType === AccountType.SOLE_PROPRIETORSHIP ? 'SOLE_PROPRIETORSHIP' : 'LEGAL_ENTITY',
        purposeBusinessRelationship: 'Kauf und Verkauf von DeFiChain Assets',
      };

      await this.uploadDocument(
        userDataId,
        true,
        KycDocument.INITIAL_CUSTOMER_INFORMATION,
        'v1',
        'content',
        'initial-customer-information.json',
        KycContentType.JSON,
        organizationInfo,
      );
    }
  }

  public async uploadDocument(
    userDataId: number,
    isOrganization: boolean,
    document: KycDocument,
    version: string,
    part: string,
    fileName: string,
    contentType: KycContentType,
    data: any,
  ): Promise<boolean> {
    await this.kycApi.createDocumentVersion(userDataId, isOrganization, document, version);
    await this.kycApi.createDocumentVersionPart(
      userDataId,
      isOrganization,
      document,
      version,
      part,
      fileName,
      contentType,
    );
    const successful = await this.kycApi.uploadDocument(
      userDataId,
      isOrganization,
      document,
      version,
      part,
      contentType,
      data,
    );
    if (successful) {
      await this.kycApi.changeDocumentState(userDataId, isOrganization, document, version, KycDocumentState.COMPLETED);
    }

    return successful;
  }

  // --- KYC PROGRESS --- //
  public async getKycProgress(userDataId: number, kycStatus: KycStatus): Promise<KycProgress> {
    const documentType =
      kycStatus === KycStatus.CHATBOT
        ? KycDocument.CHATBOT
        : kycStatus === KycStatus.ONLINE_ID
        ? KycDocument.ONLINE_IDENTIFICATION
        : KycDocument.VIDEO_IDENTIFICATION;

    const versions = await this.kycApi.getDocumentVersions(userDataId, documentType);
    if (!versions?.length) return KycProgress.ONGOING;

    // completed
    if (versions.find((doc) => doc.state === KycDocumentState.COMPLETED) != null) return KycProgress.COMPLETED;

    // failed
    if (versions.find((doc) => doc.state != KycDocumentState.FAILED && this.documentAge(doc) < 7) == null)
      return KycProgress.FAILED;

    // expired
    if (this.documentAge(versions[0]) > 2 && this.documentAge(versions[0]) < 7) return KycProgress.EXPIRING;

    return KycProgress.ONGOING;
  }

  async goToStatus(userData: UserData, status: KycStatus): Promise<UserData> {
    if ([KycStatus.CHATBOT, KycStatus.ONLINE_ID, KycStatus.VIDEO_ID].includes(status)) {
      const identType =
        status === KycStatus.CHATBOT
          ? KycDocument.INITIATE_CHATBOT_IDENTIFICATION
          : status === KycStatus.ONLINE_ID
          ? KycDocument.INITIATE_ONLINE_IDENTIFICATION
          : KycDocument.INITIATE_VIDEO_IDENTIFICATION;

      const initiateData = await this.kycApi.initiateIdentification(userData.id, false, identType);
      userData.spiderData = await this.updateSpiderData(userData, initiateData);
    }

    return this.updateKycStatus(userData, status);
  }

  public async chatbotCompleted(userData: UserData): Promise<UserData> {
    userData.riskState = await this.kycApi.checkCustomer(userData.id);

    userData = await this.storeChatbotResult(userData);

    const vipUser = await this.userRepo.findOne({ where: { userData: { id: userData.id }, role: UserRole.VIP } });
    return vipUser
      ? await this.goToStatus(userData, KycStatus.VIDEO_ID)
      : await this.goToStatus(userData, KycStatus.ONLINE_ID);
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

  public updateKycState(userData: UserData, state: KycState): UserData {
    console.log(`KYC change: state of user ${userData.id} (${userData.kycStatus}): ${userData.kycState} -> ${state}`);

    userData.kycState = state;
    return userData;
  }

  private async updateSpiderData(userData: UserData, initiateData: InitiateResponse) {
    const spiderData =
      (await this.spiderDataRepo.findOne({ userData: { id: userData.id } })) ??
      this.spiderDataRepo.create({ userData: userData });

    const locator = initiateData.locators[0];
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
      KycDocument.ONLINE_IDENTIFICATION,
      version,
      KycDocument.IDENTIFICATION_LOG,
    );
    return onlineId
      ? `https://go.online-ident.ch/app/kycspiderauto/identifications/${onlineId.identificationId}/identification/start`
      : null;
  }

  private async storeChatbotResult(userData: UserData): Promise<UserData> {
    try {
      const spiderData = userData.spiderData ?? (await this.spiderDataRepo.findOne({ userData: { id: userData.id } }));
      if (spiderData) {
        // get the version of the completed chatbot document
        const versions = await this.kycApi.getDocumentVersions(userData.id, KycDocument.CHATBOT);
        const completedVersion = versions.find((u) => u.state == KycDocumentState.COMPLETED)?.name;

        // get and store the result
        const chatbotResult = await this.kycApi.getDocument(
          userData.id,
          KycDocument.CHATBOT_ONBOARDING,
          completedVersion,
          'export',
        );
        spiderData.result = JSON.stringify(chatbotResult);
        userData.spiderData = await this.spiderDataRepo.save(spiderData);

        // update user data
        const formItems = JSON.parse(chatbotResult?.attributes?.form)?.items;
        userData.contributionAmount = formItems?.['global.contribution']?.value?.split(' ')[1];
        userData.contributionCurrency = formItems?.['global.contribution']?.value?.split(' ')[0];
        userData.plannedContribution = formItems?.['global.plannedDevelopmentOfAssets']?.value?.en;
      }
    } catch (e) {
      console.error(`Failed to store chatbot result for user ${userData.id}:`, e);
    }

    return userData;
  }
}
