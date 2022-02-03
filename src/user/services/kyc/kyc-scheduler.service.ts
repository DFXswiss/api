import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { KycState, KycStatus, UserData } from 'src/user/models/userData/userData.entity';
import { UserDataRepository } from 'src/user/models/userData/userData.repository';
import { MailService } from '../../../shared/services/mail.service';
import { KycApiService } from './kyc-api.service';
import { Customer, KycDocument, State } from './dto/kyc.dto';
import { SettingService } from 'src/shared/setting/setting.service';
import { UserDataService } from 'src/user/models/userData/userData.service';
import { In } from 'typeorm';
import { Lock } from 'src/shared/lock';

enum KycStepState {
  ONGOING = 'Ongoing',
  COMPLETED = 'Completed',
  FAILED = 'Failed',
  EXPIRED = 'Expired',
}

@Injectable()
export class KycSchedulerService {
  private readonly lock = new Lock(1800);

  constructor(
    private mailService: MailService,
    private userDataRepo: UserDataRepository,
    private userDataService: UserDataService,
    private kycApi: KycApiService,
    private settingService: SettingService,
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
      const changedRefs = await this.kycApi.getCustomerReferences(+(lastModificationTime ?? 0));
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
    const { checkResult, customer } = await this.kycApi.getKycData(userData.id);
    userData.riskState = checkResult;
    userData.kycCustomerId = customer.id;

    // check KYC progress
    if (![KycStatus.CHATBOT, KycStatus.ONLINE_ID, KycStatus.VIDEO_ID].includes(userData.kycStatus)) return;

    const stepState = await this.getStepState(userData.id, userData.kycStatus);
    if (stepState === KycStepState.ONGOING) return;

    switch (stepState) {
      case KycStepState.COMPLETED:
        userData = await this.stepCompleted(userData);
        break;
      case KycStepState.FAILED:
        if (userData.kycState != KycState.FAILED) {
          userData = await this.stepFailed(userData, customer);
        }
        break;
      case KycStepState.EXPIRED:
        if (![KycState.REMINDED].includes(userData.kycState)) {
          userData = await this.stepExpired(userData, customer);
        }
        break;
    }

    await this.userDataRepo.save(userData);
  }

  private async getStepState(userDataId: number, kycStatus: KycStatus): Promise<KycStepState> {
    // TODO: centralize this mapping
    const documentType =
      kycStatus === KycStatus.CHATBOT
        ? KycDocument.CHATBOT
        : kycStatus === KycStatus.ONLINE_ID
        ? KycDocument.ONLINE_IDENTIFICATION
        : KycDocument.VIDEO_IDENTIFICATION;

    const versions = await this.kycApi.getDocumentVersion(userDataId, documentType);
    if (!versions?.length) return KycStepState.ONGOING;

    // completed
    if (versions.find((doc) => doc.state === State.COMPLETED) != null) return KycStepState.COMPLETED;

    // failed
    if (versions.find((doc) => doc.state != State.FAILED && this.dateDiffInDays(doc.creationTime) < 7) == null)
      return KycStepState.FAILED;

    // expired
    if (this.dateDiffInDays(versions[0].creationTime) > 2 && this.dateDiffInDays(versions[0].creationTime) < 7)
      return KycStepState.EXPIRED;

    return KycStepState.ONGOING;
  }

  private async stepCompleted(userData: UserData): Promise<UserData> {
    if (userData.kycStatus === KycStatus.CHATBOT) {
      userData = await this.userDataService.finishChatBot(userData);
      await this.mailService.sendChatBotMail(
        userData.firstname,
        userData.mail,
        userData.language?.symbol?.toLowerCase(),
      );
    } else {
      userData.kycStatusChangeDate = new Date();
      userData.kycStatus = KycStatus.MANUAL;
    }

    console.log(`KYC change: status of user ${userData.id}: ${userData.kycStatus}`);

    userData.kycState = KycState.NA;
    return userData;
  }

  private async stepFailed(userData: UserData, customer: Customer): Promise<UserData> {
    if (userData.kycStatus === KycStatus.ONLINE_ID) {
      // online ID failed => trigger video ID
      await this.userDataService.initiateIdentification(userData, false, KycDocument.INITIATE_VIDEO_IDENTIFICATION);
      await this.mailService.sendOnlineFailedMail(
        customer.names[0].firstName,
        customer.emails[0],
        userData?.language?.symbol?.toLocaleLowerCase(),
      );

      console.log(`KYC change: status of user ${userData.id}: ${userData.kycStatus}`);
    } else {
      await this.mailService.sendSupportFailedMail(userData, customer.id);
      userData.kycState = KycState.FAILED;

      console.log(`KYC change: state of user ${userData.id} (${userData.kycStatus}): ${userData.kycState}`);
    }

    return userData;
  }

  private async stepExpired(userData: UserData, customer: Customer): Promise<UserData> {
    await this.mailService.sendReminderMail(customer.names[0].firstName, customer.emails[0], userData.kycStatus);
    userData.kycState = KycState.REMINDED;

    console.log(`KYC change: state of user ${userData.id} (${userData.kycStatus}): ${userData.kycState}`);
    return userData;
  }

  private dateDiffInDays(creationTime: number) {
    const timeDiff = new Date().getTime() - new Date(creationTime).getTime();
    return timeDiff / (1000 * 3600 * 24);
  }
}
