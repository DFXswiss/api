import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SpiderDataRepository } from 'src/subdomains/generic/user/models/spider-data/spider-data.repository';
import {
  KycCompleted,
  KycInProgress,
  KycState,
  KycStatus,
  KycType,
  UserData,
} from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycDocument, KycDocuments, InitiateResponse } from '../../services/spider/dto/spider.dto';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { IdentResultDto } from 'src/subdomains/generic/user/models/ident/dto/ident-result.dto';
import { DocumentState, SpiderService } from 'src/subdomains/generic/user/services/spider/spider.service';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserRepository } from '../user/user.repository';
import { Config } from 'src/config/config';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { WebhookService } from '../../services/webhook/webhook.service';

@Injectable()
export class KycProcessService {
  constructor(
    private readonly spiderDataRepo: SpiderDataRepository,
    private readonly spiderService: SpiderService,
    private readonly notificationService: NotificationService,
    private readonly userRepo: UserRepository,
    private readonly webhookService: WebhookService,
  ) {}

  // --- GENERAL METHODS --- //
  async startKycProcess(userData: UserData): Promise<UserData> {
    return this.goToStatus(userData, userData.kycType === KycType.LOCK ? KycStatus.ONLINE_ID : KycStatus.CHATBOT);
  }

  async checkKycProcess(userData: UserData): Promise<UserData> {
    // check if chatbot already finished
    if (userData.kycStatus === KycStatus.CHATBOT) {
      const chatbotProgress = await this.getKycProgress(userData.id, userData.kycStatus);
      if (chatbotProgress === DocumentState.COMPLETED) {
        return this.chatbotCompleted(userData);
      }
    }

    // retrigger, if failed
    if (userData.kycState === KycState.FAILED) {
      return this.goToStatus(userData, userData.kycStatus);
    }

    return userData;
  }

  async getKycProgress(userDataId: number, kycStatus: KycStatus): Promise<DocumentState> {
    const documentType = KycDocuments[kycStatus].document;
    return this.spiderService.getDocumentState(userDataId, documentType);
  }

  async goToStatus(userData: UserData, status: KycStatus): Promise<UserData> {
    if (KycInProgress(status)) {
      const identType = KycDocuments[status].ident;
      const initiateData = await this.spiderService.initiateIdentification(userData.id, identType);
      userData.spiderData = await this.updateSpiderData(userData, initiateData);
    }

    if (KycCompleted(status) && userData.isDfxUser) {
      if (userData.mail) {
        await this.notificationService.sendMail({
          type: MailType.USER,
          input: { translationKey: 'mail.kyc.success', translationParams: {}, userData },
        });
      } else {
        console.error(`Failed to send KYC completion mail for user data ${userData.id}: user has no email`);
      }
    }

    userData = this.updateKycStatus(userData, status);

    await this.webhookService.kycChanged(userData);

    return userData;
  }

  private updateKycStatus(userData: UserData, status: KycStatus): UserData {
    console.log(`KYC change: status of user ${userData.id}: ${userData.kycStatus} -> ${status}`);

    userData.kycStatus = status;
    userData.kycState = KycState.NA;
    userData.kycStatusChangeDate = new Date();
    return userData;
  }

  updateKycState(userData: UserData, state: KycState): UserData {
    console.log(`KYC change: state of user ${userData.id} (${userData.kycStatus}): ${userData.kycState} -> ${state}`);

    userData.kycState = state;
    return userData;
  }

  async stepFailed(userData: UserData): Promise<UserData> {
    // online ID failed => trigger video ID
    if (userData.kycStatus === KycStatus.ONLINE_ID) {
      userData = await this.goToStatus(userData, KycStatus.VIDEO_ID);

      if (userData.isDfxUser) {
        await this.notificationService
          .sendMail({
            type: MailType.USER,
            input: {
              userData,
              translationKey: 'mail.kyc.failed',
              translationParams: {
                url: `${Config.payment.url}/kyc?code=${userData.kycHash}`,
              },
            },
          })
          .catch(() => null);
      }

      return userData;
    }

    // notify support
    await this.notificationService.sendMail({ type: MailType.KYC_SUPPORT, input: { userData } });

    //kyc Webhook external Services
    await this.webhookService.kycFailed(userData, 'Kyc step failed');
    return this.updateKycState(userData, KycState.FAILED);
  }

  // --- CHATBOT --- //
  async chatbotCompleted(userData: UserData): Promise<UserData> {
    userData.riskState = await this.spiderService.checkCustomer(userData.id);

    userData = await this.storeChatbotResult(userData);

    const isVipUser = await this.hasRole(userData.id, UserRole.VIP);

    return isVipUser
      ? this.goToStatus(userData, KycStatus.VIDEO_ID)
      : this.goToStatus(userData, KycStatus.ONLINE_ID);
  }

  async storeChatbotResult(userData: UserData): Promise<UserData> {
    try {
      const spiderData = userData.spiderData ?? (await this.spiderDataRepo.findOne({ userData: { id: userData.id } }));
      if (spiderData) {
        // get and store the result
        const chatbotResult = {
          person: await this.spiderService.getChatbotResult(userData.id, false),
          organization:
            userData.accountType === AccountType.PERSONAL
              ? undefined
              : await this.spiderService.getChatbotResult(userData.id, true),
        };

        const chatbotExport = JSON.parse(
          (await this.spiderService.getChatbotExport(userData.id, false)).attributes?.form,
        )?.items;

        spiderData.chatbotResult = JSON.stringify(chatbotResult);
        spiderData.chatbotExport = JSON.stringify(chatbotExport);
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

  // --- IDENT --- //
  async identCompleted(userData: UserData, result: IdentResultDto): Promise<UserData> {
    userData = await this.storeIdentResult(userData, result);

    if (userData.isDfxUser) {
      await this.notificationService
        .sendMail({
          type: MailType.USER,
          input: { userData, translationKey: 'mail.kyc.ident', translationParams: {} },
        })
        .catch(() => null);
    }

    return this.goToStatus(userData, KycStatus.CHECK);
  }

  async identInReview(userData: UserData, result: IdentResultDto): Promise<UserData> {
    userData = await this.storeIdentResult(userData, result);

    return this.updateKycState(userData, KycState.REVIEW);
  }

  async identFailed(userData: UserData, result: IdentResultDto): Promise<UserData> {
    userData = await this.storeIdentResult(userData, result);

    return this.stepFailed(userData);
  }

  async storeIdentResult(userData: UserData, result: IdentResultDto): Promise<UserData> {
    try {
      const spiderData = userData.spiderData ?? (await this.spiderDataRepo.findOne({ userData: { id: userData.id } }));
      if (spiderData) {
        spiderData.identResult = JSON.stringify(result);
        userData.spiderData = await this.spiderDataRepo.save(spiderData);
      }
    } catch (e) {
      console.error(`Failed to store ident result for user ${userData.id}:`, e);
    }

    return userData;
  }

  // --- HELPER METHODS --- //
  private async hasRole(userDataId: number, role: UserRole): Promise<boolean> {
    return this.userRepo.findOne({ where: { userData: { id: userDataId }, role } }).then((u) => u != null);
  }

  private async updateSpiderData(userData: UserData, initiateData: InitiateResponse) {
    const sessionData = await this.getSessionData(userData, initiateData);

    const spiderData =
      (await this.spiderDataRepo.findOne({ userData: { id: userData.id } })) ??
      this.spiderDataRepo.create({ userData: userData });

    spiderData.url = sessionData.url;
    spiderData.secondUrl = sessionData.secondUrl;
    if (sessionData.identIdentificationId) {
      spiderData.identIdentificationIds = spiderData.identIdentificationIds
        ? `${spiderData.identIdentificationIds},${sessionData.identIdentificationId}`
        : sessionData.identIdentificationId;
    }

    return this.spiderDataRepo.save(spiderData);
  }

  private async getSessionData(
    userData: UserData,
    initiateData: InitiateResponse,
  ): Promise<{ url: string; secondUrl?: string; identIdentificationId?: string }> {
    const locator = initiateData.locators?.[0];
    if (!locator) {
      console.error(`Failed to initiate identification. Initiate result:`, initiateData);
      throw new ServiceUnavailableException('Identification initiation failed');
    }

    switch (locator.document) {
      case KycDocument.CHATBOT:
        return { url: initiateData.sessionUrl + '&nc=true', secondUrl: null };

      case KycDocument.ONLINE_IDENTIFICATION:
        const log = await this.spiderService.getOnlineIdLog(userData, locator.version);

        return {
          url: initiateData.sessionUrl,
          secondUrl: log ? this.spiderService.getOnlineIdUrl(log.identificationId) : null,
          identIdentificationId: log ? log.identificationId : null,
        };

      case KycDocument.VIDEO_IDENTIFICATION:
        return {
          url: initiateData.sessionUrl,
          secondUrl: null,
          identIdentificationId: await this.spiderService.getVideoIdentificationId(initiateData.sessionUrl),
        };
    }
  }
}
