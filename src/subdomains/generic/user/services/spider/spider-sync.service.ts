import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, Process } from 'src/config/config';
import { AzureStorageService } from 'src/integration/infrastructure/azure-storage.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { IdentResultDto } from 'src/subdomains/generic/user/models/ident/dto/ident-result.dto';
import { KycProcessService } from 'src/subdomains/generic/user/models/kyc/kyc-process.service';
import { SpiderDataRepository } from 'src/subdomains/generic/user/models/spider-data/spider-data.repository';
import {
  IdentCompleted,
  IdentInProgress,
  KycInProgress,
  KycInProgressStates,
  KycState,
  KycStatus,
  UserData,
} from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataRepository } from 'src/subdomains/generic/user/models/user-data/user-data.repository';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { MailKey, MailTranslationKey } from 'src/subdomains/supporting/notification/factories/mail.factory';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { In, LessThan } from 'typeorm';
import { AccountType } from '../../models/user-data/account-type.enum';
import {
  DocumentInfo,
  DocumentVersionPart,
  KycContentType,
  KycDocument,
  KycDocumentState,
  KycDocuments,
} from './dto/spider.dto';
import { SpiderApiService } from './spider-api.service';
import { DocumentState, SpiderService } from './spider.service';

@Injectable()
export class SpiderSyncService {
  private readonly logger = new DfxLogger(SpiderSyncService);

  private readonly storageService: AzureStorageService;

  private readonly kycStatusTranslation = {
    [KycStatus.CHATBOT]: 'Chatbot',
    [KycStatus.ONLINE_ID]: 'Online ID',
    [KycStatus.VIDEO_ID]: 'Video ID',
  };

  constructor(
    private readonly notificationService: NotificationService,
    private readonly userDataRepo: UserDataRepository,
    private readonly kycProcess: KycProcessService,
    private readonly spiderApi: SpiderApiService,
    private readonly spiderService: SpiderService,
    private readonly settingService: SettingService,
    private readonly spiderDataRepo: SpiderDataRepository,
  ) {
    this.storageService = new AzureStorageService('kyc');
  }

  @Cron(CronExpression.EVERY_2_HOURS)
  @Lock()
  async checkOngoingKyc() {
    if (Config.processDisabled(Process.KYC)) return;

    const userInProgress = await this.userDataRepo.find({
      select: ['id'],
      where: [
        {
          kycStatus: In(KycInProgressStates),
          kycState: KycState.NA,
          kycStatusChangeDate: LessThan(Util.daysBefore(Config.kycSpider.reminderAfterDays)),
        },
        {
          kycStatus: In(KycInProgressStates),
          kycState: KycState.REMINDED,
          kycStatusChangeDate: LessThan(Util.daysBefore(Config.kycSpider.failAfterDays)),
        },
      ],
    });

    for (const user of userInProgress) {
      try {
        await this.syncKycUser(user.id);
      } catch (e) {
        this.logger.error(`Exception during KYC check for user ${user.id}:`, e);

        await this.notificationService.sendMail({
          type: MailType.ERROR_MONITORING,
          input: { subject: 'KYC Error', errors: [`Exception during KYC check for user ${user.id}: ${e}`] },
        });
      }
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  @Lock(7200)
  async continuousSync() {
    if (Config.processDisabled(Process.KYC)) return;

    const settingKey = 'spiderModificationDate';
    const lastModificationTime = await this.settingService.get(settingKey);
    const newModificationTime = Date.now().toString();

    await this.syncKycData(+(lastModificationTime ?? 0));

    await this.settingService.set(settingKey, newModificationTime);
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  @Lock()
  async dailySync() {
    if (Config.processDisabled(Process.KYC)) return;

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
        this.logger.error(`Exception during KYC sync for user ${userDataId}:`, e);

        await this.notificationService.sendMail({
          type: MailType.ERROR_MONITORING,
          input: { subject: 'KYC Error', errors: [`Exception during KYC sync for user ${userDataId}: ${e}`] },
        });
      }
    }
  }

  async syncKycUser(userDataId: number, forceSync = false): Promise<void> {
    let userData = await this.userDataRepo.findOne({
      where: { id: userDataId },
      relations: ['spiderData', 'users', 'users.wallet'],
    });
    if (!userData) return;

    // update KYC data
    const [customer, risks] = await Promise.all([
      this.spiderApi.getCustomer(userData.id),
      this.spiderApi.getCheckResult(userData.id),
    ]);
    if (!customer) return;

    userData.kycCustomerId = customer.id;
    userData.riskResult = risks;

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

      if (!userData.spiderData.identPdf) this.logger.error(`Failed to fetch ident PDF for user ${userDataId}`);

      await this.spiderDataRepo.save(userData.spiderData);
    }

    await this.syncKycFiles(userData);

    // force sync (chatbot and ident result)
    if (forceSync) {
      userData = await this.kycProcess.storeChatbotResult(userData);

      const identResult = await this.fetchIdentResult(userData);
      userData = await this.kycProcess.storeIdentResult(userData, identResult);
    }

    userData.kycSteps = undefined; // ignore steps
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

      if (userData.isDfxUser) {
        await this.notificationService
          .sendMail({
            type: MailType.USER,
            input: {
              userData,
              title: `${MailTranslationKey.KYC_CHATBOT}.title`,
              salutation: { key: `${MailTranslationKey.KYC_CHATBOT}.salutation` },
              suffix: [
                { key: MailKey.SPACE, params: { value: '1' } },
                {
                  key: `${MailTranslationKey.KYC}.next_step`,
                  params: { url: `${Config.frontend.payment}/kyc?code=${userData.kycHash}` },
                },
                { key: MailKey.SPACE, params: { value: '2' } },
                { key: `${MailTranslationKey.KYC}.last_step` },
                { key: MailKey.DFX_TEAM_CLOSING },
              ],
            },
          })
          .catch(() => null);
      }
    } else {
      const identResult = await this.fetchIdentResult(userData);
      userData = await this.kycProcess.identCompleted(userData, identResult);
    }
    return userData;
  }

  private async handleFailed(userData: UserData): Promise<UserData> {
    return this.kycProcess.stepFailed(userData);
  }

  private async handleExpiring(userData: UserData): Promise<UserData> {
    // send reminder
    if (userData.isDfxUser) {
      await this.notificationService
        .sendMail({
          type: MailType.USER,
          input: {
            userData,
            title: `${MailTranslationKey.KYC_REMINDER}.title`,
            salutation: { key: `${MailTranslationKey.KYC_REMINDER}.salutation` },
            suffix: [
              { key: MailKey.SPACE, params: { value: '1' } },
              {
                key: `${MailTranslationKey.KYC_REMINDER}.message`,
                params: { status: this.kycStatusTranslation[userData.kycStatus] },
              },
              { key: MailKey.SPACE, params: { value: '2' } },
              {
                key: `${MailTranslationKey.KYC}.next_step`,
                params: { url: `${Config.frontend.payment}/kyc?code=${userData.kycHash}` },
              },
              { key: MailKey.SPACE, params: { value: '2' } },
              { key: `${MailTranslationKey.KYC}.last_step` },
              { key: MailKey.DFX_TEAM_CLOSING },
            ],
          },
        })
        .catch(() => null);
    }

    return this.kycProcess.updateKycState(userData, KycState.REMINDED);
  }

  // --- HELPER METHODS --- //

  private async getIdentPdfUrl(userData: UserData): Promise<string> {
    const result = await this.getIdentResult(userData, KycContentType.PDF);
    return result?.part
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
            (p.fileName.startsWith('DFX persönliche Identifikation Kunden vor Ort') ||
              p.fileName.startsWith('Identifikationsdokument')),
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
    let document = IdentInProgress(userData.kycStatus)
      ? KycDocuments[userData.kycStatus].document
      : KycDocument.ONLINE_IDENTIFICATION;
    let result = await this.getCompletedIdentDocument(userData, document, documentType);

    if (!result) {
      // fallback to other ident method
      document =
        document === KycDocument.ONLINE_IDENTIFICATION
          ? KycDocument.VIDEO_IDENTIFICATION
          : KycDocument.ONLINE_IDENTIFICATION;
      result = await this.getCompletedIdentDocument(userData, document, documentType);
    }

    return result;
  }

  private async getCompletedIdentDocument(
    userData: UserData,
    document: KycDocument,
    documentType: KycContentType,
  ): Promise<{ document: KycDocument; version: string; part: DocumentVersionPart }> {
    const version = await this.spiderApi.getDocumentVersion(userData.id, false, document, KycDocumentState.COMPLETED);
    if (!version) return null;

    const part = await this.spiderApi
      .getDocumentVersionParts(userData.id, false, document, version?.name)
      .then((parts) => parts.find((p) => p.contentType === documentType));
    if (!part) return null;

    return { document, version: version.name, part };
  }

  // --- FILE SYNC METHODS -- //
  public async syncKycFiles(userData: UserData, documents?: KycDocument[], singleVersion?: string): Promise<void> {
    const failedDocuments = await this.syncKycFilesFor(userData.id, false, documents, singleVersion);
    if (userData.accountType !== AccountType.PERSONAL)
      failedDocuments.push(...(await this.syncKycFilesFor(userData.id, true, documents, singleVersion)));

    if (failedDocuments.length)
      throw new Error(
        `Failed to sync KYC files for user ${userData.id}:\n${failedDocuments
          .map(({ document, error }) => `  ${document}: ${error}`)
          .join('\n')}`,
      );
  }

  private async syncKycFilesFor(
    userDataId: number,
    isOrganization: boolean,
    documents?: KycDocument[],
    singleVersion?: string,
  ): Promise<{ document: string; error: string }[]> {
    const allStorageFiles = await this.listStorageFiles(userDataId, isOrganization);
    const allSpiderFiles = await this.spiderApi.getDocumentInfos(userDataId, isOrganization, documents);

    let filesToSync = singleVersion ? this.getSingleVersion(allSpiderFiles, singleVersion) : allSpiderFiles;

    filesToSync = filesToSync.filter((spiderFile) => {
      return !allStorageFiles.some(
        (f) =>
          f.document === spiderFile.document &&
          f.metadata.version === spiderFile.version &&
          f.metadata.part === spiderFile.part,
      );
    });

    const failedDocuments = [];
    for (const document of filesToSync) {
      try {
        const data = await this.spiderApi.getBinaryDocument(
          userDataId,
          isOrganization,
          document.document,
          document.version,
          document.part,
        );

        await this.uploadFileToStorage(
          userDataId,
          isOrganization,
          document.document,
          document.version,
          document.fileName,
          data,
          document.contentType,
          {
            document: document.document.toString(),
            version: document.version,
            part: document.part,
            state: document.state.toString(),
            creationTime: document.creationTime.toISOString(),
            modificationTime: document.modificationTime.toISOString(),
            label: this.replaceIllegalChars(document.label),
            fileName: this.replaceIllegalChars(document.fileName),
            contentType: document.contentType.toString(),
            url: document.url,
          },
        );
      } catch (e) {
        failedDocuments.push({
          document: `${document.document}-${document.version}-${document.part}`,
          error: e.message,
        });
      }
    }

    return failedDocuments;
  }

  private getSingleVersion(filesToSync: DocumentInfo[], singleVersion: string): DocumentInfo[] {
    const filesByVersion = Util.groupByAccessor(filesToSync, (f) => `${f.document}-${f.version}`);
    const fileVersionsWithDate = Array.from(filesByVersion.values()).map(([file]) => ({
      document: file.document,
      version: file.version,
      date: new Date(file.creationTime).getTime(),
    }));

    const filesByType = Util.groupByAccessor(fileVersionsWithDate, (v) => v.document);
    const selectedVersions = Array.from(filesByType.values()).map((versions) =>
      singleVersion === 'newest' ? Util.maxObj(versions, 'date') : Util.minObj(versions, 'date'),
    );

    return filesToSync.filter((f) =>
      selectedVersions.some((v) => f.document === v.document && f.version === v.version),
    );
  }

  private replaceIllegalChars(str: string): string {
    str = str.split(' ').join('_');

    return encodeURIComponent(str);
  }

  async listStorageFiles(
    userDataId: number,
    isOrganization: boolean,
  ): Promise<{ document: KycDocument; version: string; name: string; metadata: Record<string, string> }[]> {
    const blobs = await this.storageService.listBlobs(`spider/${userDataId}${isOrganization ? '-organization' : ''}/`);
    return blobs.map((b) => {
      const [_s, _u, document, version, name] = b.name.split('/');
      return { name, document: document as KycDocument, version, metadata: b.metadata };
    });
  }

  async uploadFileToStorage(
    userDataId: number,
    isOrganization: boolean,
    document: KycDocument,
    version: string,
    name: string,
    data: Buffer,
    contentType: KycContentType,
    metadata: Record<string, string>,
  ) {
    const blobName = `spider/${userDataId}${isOrganization ? '-organization' : ''}/${document}/${version}/${name
      .split('/')
      .join('_')}`;
    await this.storageService.uploadBlob(blobName, data, contentType, metadata);
  }
}
