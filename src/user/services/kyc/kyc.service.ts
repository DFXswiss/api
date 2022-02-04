import { Injectable } from '@nestjs/common';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { MailService } from 'src/shared/services/mail.service';
import { SpiderDataRepository } from 'src/user/models/spider-data/spider-data.repository';
import { UserInfo } from 'src/user/models/user/user.entity';
import { UserRepository } from 'src/user/models/user/user.repository';
import { AccountType } from 'src/user/models/userData/account-type.enum';
import { KycState, KycStatus, UserData } from 'src/user/models/userData/userData.entity';
import { UserDataRepository } from 'src/user/models/userData/userData.repository';
import { KycDocument, KycContentType, KycDocumentState } from './dto/kyc.dto';
import { KycApiService } from './kyc-api.service';

@Injectable()
export class KycService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly userDataRepo: UserDataRepository,
    private readonly spiderDataRepo: SpiderDataRepository,
    private readonly mailService: MailService,
    private readonly kycApi: KycApiService,
  ) {}

  // TODO: cleanup

  public async uploadDocument(
    customerId: number,
    isOrganization: boolean,
    document: KycDocument,
    version: string,
    part: string,
    fileName: string,
    contentType: KycContentType,
    data: any,
  ): Promise<boolean> {
    await this.kycApi.createDocumentVersion(customerId, isOrganization, document, version);
    await this.kycApi.createDocumentVersionPart(
      customerId,
      isOrganization,
      document,
      version,
      part,
      fileName,
      contentType,
    );
    const successful = await this.kycApi.uploadDocument(
      customerId,
      isOrganization,
      document,
      version,
      part,
      contentType,
      data,
    );
    if (successful) {
      await this.kycApi.changeDocumentState(customerId, isOrganization, document, version, KycDocumentState.COMPLETED);
    }

    return successful;
  }

  // TODO: return userData?
  public async initiateIdentification(userData: UserData, sendMail: boolean, identType: KycDocument): Promise<string> {
    // create/update spider data
    const initiateData = await this.kycApi.initiateIdentification(userData.id, sendMail, identType);
    const spiderData =
      (await this.spiderDataRepo.findOne({ userData: { id: userData.id } })) ??
      this.spiderDataRepo.create({ userData: userData });
    spiderData.url =
      identType === KycDocument.INITIATE_CHATBOT_IDENTIFICATION
        ? initiateData.sessionUrl + '&nc=true'
        : initiateData.sessionUrl;
    spiderData.version = initiateData.locators[0].version;
    await this.spiderDataRepo.save(spiderData);

    // update user data
    userData.kycStatus =
      identType === KycDocument.INITIATE_VIDEO_IDENTIFICATION
        ? KycStatus.VIDEO_ID
        : identType === KycDocument.INITIATE_ONLINE_IDENTIFICATION
        ? KycStatus.ONLINE_ID
        : KycStatus.CHATBOT;
    userData.kycState = KycState.NA;
    userData.kycStatusChangeDate = new Date();
    userData.spiderData = spiderData;
    await this.userDataRepo.save(userData);

    return spiderData.url;
  }

  public async finishChatBot(userData: UserData): Promise<UserData> {
    userData.riskState = await this.kycApi.checkCustomer(userData.id);
    const spiderData = await this.spiderDataRepo.findOne({ userData: { id: userData.id } });

    if (spiderData) {
      const chatBotResult = await this.kycApi.getDocument(
        userData.id,
        KycDocument.CHATBOT_ONBOARDING,
        spiderData.version,
        'export',
      );

      // store chatbot result
      spiderData.result = JSON.stringify(chatBotResult);
      await this.spiderDataRepo.save(spiderData);

      // update user data
      try {
        const formItems = JSON.parse(chatBotResult?.attributes?.form)?.items;
        userData.contributionAmount = formItems?.['global.contribution']?.value?.split(' ')[1];
        userData.contributionCurrency = formItems?.['global.contribution']?.value?.split(' ')[0];
        userData.plannedContribution = formItems?.['global.plannedDevelopmentOfAssets']?.value?.en;
      } catch (e) {
        const message = `Exception during KYC checks, failed to parse chatbot result for user ${userData.id} and version ${spiderData.version}:`;
        console.error(message, e);
        await this.mailService.sendErrorMail('KYC Error', [e]);
      }
    }

    const vipUser = await this.userRepo.findOne({ where: { userData: { id: userData.id }, role: UserRole.VIP } });
    vipUser
      ? await this.initiateIdentification(userData, false, KycDocument.INITIATE_VIDEO_IDENTIFICATION)
      : await this.initiateIdentification(userData, false, KycDocument.INITIATE_ONLINE_IDENTIFICATION);

    await this.userDataRepo.save(userData);

    return userData;
  }

  async preFillChatbot(userData: UserData, userInfo: UserInfo): Promise<void> {
    // pre-fill customer info
    const customerInfo = {
      type: 'AdditionalPersonInformation',
      nickName: userInfo.firstname,
      onlyOwner: 'YES',
      businessActivity: {
        purposeBusinessRelationship: 'Kauf und Verkauf von DeFiChain Assets',
      },
    };

    await this.uploadDocument(
      userData.id,
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
        userData.id,
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
}
