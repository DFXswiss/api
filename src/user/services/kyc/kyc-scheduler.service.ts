import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { KycState, KycStatus, UserData } from 'src/user/models/userData/userData.entity';
import { UserDataRepository } from 'src/user/models/userData/userData.repository';
import { MailService } from '../../../shared/services/mail.service';
import { KycApiService } from './kyc-api.service';
import { SettingService } from 'src/shared/setting/setting.service';
import { In } from 'typeorm';
import { Lock } from 'src/shared/lock';
import { KycService, KycProgress } from './kyc.service';
import { SpiderDataRepository } from 'src/user/models/spider-data/spider-data.repository';

@Injectable()
export class KycSchedulerService {
  private readonly lock = new Lock(1800);

  constructor(
    private readonly mailService: MailService,
    private readonly userDataRepo: UserDataRepository,
    private readonly kycService: KycService,
    private readonly kycApi: KycApiService,
    private readonly settingService: SettingService,
    private readonly spiderDataRepo: SpiderDataRepository,
  ) {}

  @Interval(7200000)
  async checkOngoingKyc() {
    const userInProgress = await this.userDataRepo.find({
      select: ['id'],
      where: {
        kycStatus: In([KycStatus.CHATBOT, KycStatus.ONLINE_ID, KycStatus.VIDEO_ID]),
        kycState: In([KycState.NA, KycState.REMINDED]),
      },
    });

    for (const user of userInProgress) {
      try {
        await this.syncKycUser(user.id);
      } catch (e) {
        console.error('Exception during KYC check:', e);
        await this.mailService.sendErrorMail('KYC Error', [e]);
      }
    }
  }

  @Interval(300000)
  async syncKycData() {
    // avoid overlaps
    if (!this.lock.acquire()) return;

    try {
      const settingKey = 'spiderModificationDate';
      const lastModificationTime = await this.settingService.get(settingKey);
      const newModificationTime = Date.now().toString();

      // get KYC changes
      const changedRefs = await this.kycApi.getChangedCustomers(+(lastModificationTime ?? 0));
      const changedUserDataIds = changedRefs.map((c) => +c).filter((c) => !isNaN(c));

      // update
      for (const userDataId of changedUserDataIds) {
        try {
          await this.syncKycUser(userDataId);
        } catch (e) {
          console.error('Exception during KYC sync:', e);
          await this.mailService.sendErrorMail('KYC Error', [e]);
        }
      }

      await this.settingService.set(settingKey, newModificationTime);
    } catch (e) {
      console.error('Exception during KYC sync:', e);
      await this.mailService.sendErrorMail('KYC Error', [e]);
    }

    this.lock.release();
  }

  private async syncKycUser(userDataId: number): Promise<void> {
    let userData = await this.userDataRepo.findOne(userDataId);
    if (!userData) return;

    // update KYC data
    const [checkResult, customer] = await Promise.all([
      this.kycApi.getCheckResult(userData.id),
      this.kycApi.getCustomer(userData.id),
    ]);
    userData.riskState = checkResult;
    userData.kycCustomerId = customer?.id;

    // check KYC progress
    if ([KycStatus.CHATBOT, KycStatus.ONLINE_ID, KycStatus.VIDEO_ID].includes(userData.kycStatus)) {
      userData = await this.checkKycProgress(userData);
    }

    await this.userDataRepo.save(userData);
  }

  public async checkKycProgress(userData: UserData): Promise<UserData> {
    const progress = await this.kycService.getKycProgress(userData.id, userData.kycStatus);
    switch (progress) {
      case KycProgress.COMPLETED:
        userData = await this.handleCompleted(userData);
        break;
      case KycProgress.FAILED:
        if (userData.kycState != KycState.FAILED) {
          userData = await this.handleFailed(userData);
        }
        break;
      case KycProgress.EXPIRING:
        if (userData.kycState !== KycState.REMINDED) {
          userData = await this.handleExpiring(userData);
        }
        break;
    }

    return userData;
  }

  private async handleCompleted(userData: UserData): Promise<UserData> {
    if (userData.kycStatus === KycStatus.CHATBOT) {
      userData = await this.kycService.chatbotCompleted(userData);

      await this.mailService.sendChatbotCompleteMail(
        userData.firstname,
        userData.mail,
        userData.language?.symbol?.toLowerCase(),
        userData.spiderData?.url,
      );
    } else {
      await this.mailService.sendIdentificationCompleteMail(
        userData.firstname,
        userData.mail,
        userData.language?.symbol?.toLowerCase(),
      );
      userData = await this.kycService.goToStatus(userData, KycStatus.MANUAL);
    }
    return userData;
  }

  private async handleFailed(userData: UserData): Promise<UserData> {
    // online ID failed => trigger video ID
    if (userData.kycStatus === KycStatus.ONLINE_ID) {
      userData = await this.kycService.goToStatus(userData, KycStatus.VIDEO_ID);

      await this.mailService.sendOnlineFailedMail(
        userData.firstname,
        userData.mail,
        userData?.language?.symbol?.toLocaleLowerCase(),
        userData.spiderData?.url,
      );
      return userData;
    }

    // notify support
    await this.mailService.sendKycFailedMail(userData, userData.kycCustomerId);
    return this.kycService.updateKycState(userData, KycState.FAILED);
  }

  private async handleExpiring(userData: UserData): Promise<UserData> {
    const spiderData = await this.spiderDataRepo.findOne({
      where: { userData: userData.id },
    });
    // send reminder
    await this.mailService.sendKycReminderMail(
      userData.firstname,
      userData.mail,
      userData.kycStatus,
      userData.language?.symbol?.toLowerCase(),
      spiderData.url,
    );
    return this.kycService.updateKycState(userData, KycState.REMINDED);
  }
}
