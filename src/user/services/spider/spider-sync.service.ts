import { Injectable } from '@nestjs/common';
import { Interval, Cron, CronExpression } from '@nestjs/schedule';
import {
  IdentCompleted,
  IdentInProgress,
  KycInProgress,
  KycInProgressStates,
  KycState,
  KycStatus,
  UserData,
} from 'src/user/models/user-data/user-data.entity';
import { UserDataRepository } from 'src/user/models/user-data/user-data.repository';
import { SpiderApiService } from './spider-api.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { In, LessThan } from 'typeorm';
import { Lock } from 'src/shared/lock';
import { SpiderDataRepository } from 'src/user/models/spider-data/spider-data.repository';
import { Util } from 'src/shared/util';
import { Config } from 'src/config/config';
import { KycDocuments, KycDocumentState, KycContentType, KycDocument, DocumentVersionPart } from './dto/spider.dto';
import { IdentResultDto } from 'src/user/models/ident/dto/ident-result.dto';
import { DocumentState, SpiderService } from './spider.service';
import { KycProcessService } from 'src/user/models/kyc/kyc-process.service';
import { NotificationService } from 'src/notification/services/notification.service';
import { MailType } from 'src/notification/enums';

@Injectable()
export class SpiderSyncService {
  kycStatusTranslation = {
    [KycStatus.CHATBOT]: 'Chatbot',
    [KycStatus.ONLINE_ID]: 'Online ID',
    [KycStatus.VIDEO_ID]: 'Video ID',
  };
  private readonly lock = new Lock(1800);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly userDataRepo: UserDataRepository,
    private readonly kycProcess: KycProcessService,
    private readonly spiderApi: SpiderApiService,
    private readonly spiderService: SpiderService,
    private readonly settingService: SettingService,
    private readonly spiderDataRepo: SpiderDataRepository,
  ) {}

  @Interval(7230000)
  async checkOngoingKyc() {
    const userInProgress = await this.userDataRepo.find({
      select: ['id'],
      where: [
        {
          kycStatus: In(KycInProgressStates),
          kycState: KycState.NA,
          kycStatusChangeDate: LessThan(Util.daysBefore(Config.kyc.reminderAfterDays)),
        },
        {
          kycStatus: In(KycInProgressStates),
          kycState: KycState.REMINDED,
          kycStatusChangeDate: LessThan(Util.daysBefore(Config.kyc.failAfterDays)),
        },
      ],
    });

    for (const user of userInProgress) {
      try {
        await this.syncKycUser(user.id);
      } catch (e) {
        console.error(`Exception during KYC check for user ${user.id}:`, e);

        await this.notificationService.sendMail({
          type: MailType.ERROR_MONITORING,
          input: { subject: 'KYC Error', errors: [`Exception during KYC check for user ${user.id}: ${e}`] },
        });
      }
    }
  }

  @Interval(300000)
  async continuousSync() {
    // avoid overlaps
    if (!this.lock.acquire()) return;

    const settingKey = 'spiderModificationDate';
    const lastModificationTime = await this.settingService.get(settingKey);
    const newModificationTime = Date.now().toString();

    await this.syncKycData(+(lastModificationTime ?? 0));

    await this.settingService.set(settingKey, newModificationTime);

    this.lock.release();
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async dailySync() {
    const modificationDate = Util.daysBefore(1);
    await this.syncKycData(modificationDate.getTime());
  }

  private async syncKycData(modificationTime: number) {
    // get KYC changes
    const changedRefs = await this.spiderApi.getChangedCustomers(modificationTime);
    const changedUserDataIds = changedRefs.map((c) => +c).filter((c) => !isNaN(c));

    // update
    for (const userDataId of changedUserDataIds) {
      try {
        await this.syncKycUser(userDataId);
      } catch (e) {
        console.error(`Exception during KYC sync for user ${userDataId}:`, e);

        await this.notificationService.sendMail({
          type: MailType.ERROR_MONITORING,
          input: { subject: 'KYC Error', errors: [`Exception during KYC sync for user ${userDataId}: ${e}`] },
        });
      }
    }
  }

  async syncKycUser(userDataId: number, forceSync = false): Promise<void> {
    let userData = await this.userDataRepo.findOne({ where: { id: userDataId }, relations: ['spiderData'] });
    if (!userData) return;

    // update KYC data
    const [customer, { result, risks }] = await Promise.all([
      this.spiderApi.getCustomer(userData.id),
      this.spiderApi.getCheckResult(userData.id),
    ]);
    userData.kycCustomerId = customer?.id;
    userData.riskState = result;
    userData.riskRoots = result === 'c' ? null : JSON.stringify(risks);

    // check KYC progress
    if (KycInProgress(userData.kycStatus)) {
      userData = await this.checkKycProgress(userData);
    }

    if (IdentCompleted(userData.kycStatus) && !userData.spiderData.identPdf) {
      userData.spiderData.identPdf = await this.getIdentPdfUrl(userData);
      if (!userData.spiderData.identPdf) {
        userData.spiderData.identPdf = await this.getIdentManualPdfUrl(userData);
        if (userData.spiderData.identPdf) {
          userData.spiderData.identResult = JSON.stringify({
            identificationprocess: { result: 'SUCCESS', type: 'MANUAL' },
          });
        }
      }
      await this.spiderDataRepo.save(userData.spiderData);
    }

    // force sync (chatbot and ident result)
    if (forceSync) {
      userData = await this.kycProcess.storeChatbotResult(userData);

      const identResult = await this.fetchIdentResult(userData);
      userData = await this.kycProcess.storeIdentResult(userData, identResult);
    }

    await this.userDataRepo.save(userData);
  }

  public async checkKycProgress(userData: UserData): Promise<UserData> {
    const progress = await this.kycProcess.getKycProgress(userData.id, userData.kycStatus);
    switch (progress) {
      case DocumentState.COMPLETED:
        userData = await this.handleCompleted(userData);
        break;
      case DocumentState.FAILED:
        if (userData.kycState != KycState.FAILED) {
          userData = await this.handleFailed(userData);
        }
        break;
      case DocumentState.EXPIRING:
        if (userData.kycState !== KycState.REMINDED) {
          userData = await this.handleExpiring(userData);
        }
        break;
    }

    return userData;
  }

  private async handleCompleted(userData: UserData): Promise<UserData> {
    if (userData.kycStatus === KycStatus.CHATBOT) {
      userData = await this.kycProcess.chatbotCompleted(userData);

      await this.notificationService
        .sendMail({
          type: MailType.USER,
          input: {
            userData,
            translationKey: 'mail.kyc.chatbot',
            translationParams: {
              url: `${Config.payment.url}/kyc?code=${userData.kycHash}`,
            },
          },
        })
        .catch(() => null);
    } else {
      const identResult = await this.fetchIdentResult(userData);
      userData = await this.kycProcess.identCompleted(userData, identResult);
    }
    return userData;
  }

  private async handleFailed(userData: UserData): Promise<UserData> {
    return await this.kycProcess.stepFailed(userData);
  }

  private async handleExpiring(userData: UserData): Promise<UserData> {
    // send reminder
    await this.notificationService
      .sendMail({
        type: MailType.USER,
        input: {
          userData,
          translationKey: 'mail.kyc.reminder',
          translationParams: {
            status: this.kycStatusTranslation[userData.kycStatus],
            url: `${Config.payment.url}/kyc?code=${userData.kycHash}`,
          },
        },
      })
      .catch(() => null);

    return this.kycProcess.updateKycState(userData, KycState.REMINDED);
  }

  // --- HELPER METHODS --- //

  private async getIdentPdfUrl(userData: UserData): Promise<string> {
    const result = await this.getIdentResult(userData, KycContentType.PDF);
    return result
      ? this.spiderService.getDocumentUrl(userData.kycCustomerId, result.document, result.version, result.part.name)
      : null;
  }

  private async getIdentManualPdfUrl(userData: UserData): Promise<string> {
    const version = await this.spiderApi.getDocumentVersion(
      userData.id,
      false,
      KycDocument.PASSPORT_OR_ID,
      KycDocumentState.COMPLETED,
    );

    if (!version) return null;

    const part = await this.spiderApi
      .getDocumentVersionParts(userData.id, false, KycDocument.PASSPORT_OR_ID, version.name)
      .then((parts) =>
        parts.find(
          (p) =>
            p.contentType === KycContentType.PDF &&
            p.fileName.startsWith('DFX persönliche Identifikation Kunden vor Ort'),
        ),
      );
    return part
      ? this.spiderService.getDocumentUrl(userData.kycCustomerId, KycDocument.PASSPORT_OR_ID, version.name, part.name)
      : null;
  }

  private async fetchIdentResult(userData: UserData): Promise<IdentResultDto> {
    const result = await this.getIdentResult(userData, KycContentType.XML);
    if (!result) throw new Error(`No XML ident result found for user ${userData.id}`);

    const file = await this.spiderApi.getDocument<string>(
      userData.id,
      false,
      result.document,
      result.version,
      result.part.name,
    );
    const content = Util.parseXml<any>(file);

    const identificationResult = JSON.stringify(content.identifications.identification)
      .split('@_status')
      .join('status')
      .split('#text')
      .join('value')
      .split('@_original')
      .join('original');

    return JSON.parse(identificationResult);
  }

  private async getIdentResult(
    userData: UserData,
    documentType: KycContentType,
  ): Promise<{ document: KycDocument; version: string; part: DocumentVersionPart }> {
    const { document, version } = await this.getCompletedIdentDocument(userData);
    if (!version) return null;

    const part = await this.spiderApi
      .getDocumentVersionParts(userData.id, false, document, version)
      .then((parts) => parts.find((p) => p.contentType === documentType));

    return { document, version, part };
  }

  private async getCompletedIdentDocument(userData: UserData): Promise<{ document: KycDocument; version: string }> {
    let document = IdentInProgress(userData.kycStatus)
      ? KycDocuments[userData.kycStatus].document
      : KycDocument.ONLINE_IDENTIFICATION;
    let version = await this.spiderApi.getDocumentVersion(userData.id, false, document, KycDocumentState.COMPLETED);

    if (!version) {
      // fallback to other ident method
      document =
        document === KycDocument.ONLINE_IDENTIFICATION
          ? KycDocument.VIDEO_IDENTIFICATION
          : KycDocument.ONLINE_IDENTIFICATION;
      version = await this.spiderApi.getDocumentVersion(userData.id, false, document, KycDocumentState.COMPLETED);
    }

    return { document, version: version?.name };
  }
}
