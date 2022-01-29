import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { KycState, KycStatus, UserData } from 'src/user/models/userData/userData.entity';
import { UserDataRepository } from 'src/user/models/userData/userData.repository';
import { MailService } from '../../../shared/services/mail.service';
import { KycApiService } from './kyc-api.service';
import { Customer, KycDocument, State } from './dto/kyc.dto';
import { SettingService } from 'src/shared/setting/setting.service';
import { UserDataService } from 'src/user/models/userData/userData.service';

@Injectable()
export class KycSchedulerService {
  constructor(
    private mailService: MailService,
    private userDataRepo: UserDataRepository,
    private userDataService: UserDataService,
    private kycApi: KycApiService,
    private settingService: SettingService,
  ) {}

  @Interval(300000)
  async doChecks() {
    try {
      await this.doChatBotCheck();
      await this.doOnlineIdCheck();
      await this.doVideoIdCheck();
    } catch (e) {
      console.error('Exception during KYC checks:', e);
      await this.mailService.sendErrorMail('KYC Error', [e]);
    }
  }

  @Interval(1800000)
  async syncKycData() {
    const settingKey = 'spiderModificationDate';

    try {
      const lastModificationTime = await this.settingService.get(settingKey);
      const newModificationTime = Date.now().toString();

      // get KYC changes
      const changedRefs = await this.kycApi.getCustomerReferences(+(lastModificationTime ?? 0));
      const changedUserDataIds = changedRefs.map((c) => +c).filter((c) => !isNaN(c));

      // update
      for (const userDataId of changedUserDataIds) {
        const userData = await this.userDataRepo.findOne(userDataId);
        if (!userData) continue;

        // update kyc data
        const kycData = await this.userDataService.getKycData(userData.id);
        userData.riskState = kycData.checkResult;
        userData.kycCustomerId = kycData.customer.id;

        // TODO: chatbot checks

        await this.userDataRepo.save(userData);
      }

      await this.settingService.set(settingKey, newModificationTime);
    } catch (e) {
      console.error('Exception during KYC data sync:', e);
      await this.mailService.sendErrorMail('Sync Error', [e]);
    }
  }

  private async doChatBotCheck(): Promise<void> {
    await this.doCheck(KycStatus.WAIT_CHAT_BOT, KycStatus.WAIT_ONLINE_ID, [KycDocument.CHATBOT], async (userData) => {
      const updateUserData = await this.userDataService.finishChatBot(userData);
      await this.mailService.sendChatBotMail(
        updateUserData.firstname,
        updateUserData.mail,
        updateUserData.language?.symbol?.toLowerCase(),
      );
      return updateUserData;
    });
  }

  private async doOnlineIdCheck(): Promise<void> {
    await this.doCheck(KycStatus.WAIT_ONLINE_ID, KycStatus.WAIT_MANUAL, [
      KycDocument.ONLINE_IDENTIFICATION,
      KycDocument.VIDEO_IDENTIFICATION,
    ]);
  }

  private async doVideoIdCheck(): Promise<void> {
    await this.doCheck(KycStatus.WAIT_VIDEO_ID, KycStatus.WAIT_MANUAL, [
      KycDocument.VIDEO_IDENTIFICATION,
      KycDocument.ONLINE_IDENTIFICATION,
    ]);
  }

  private async doCheck(
    currentStatus: KycStatus,
    nextStatus: KycStatus,
    documentTypes: KycDocument[],
    updateAction: (userData: UserData, customer: Customer) => Promise<UserData> = (u) => Promise.resolve(u),
  ): Promise<void> {
    const userDataList = await this.userDataRepo.find({
      where: { kycStatus: currentStatus },
      relations: ['country', 'organizationCountry', 'spiderData'],
    });
    for (const key in userDataList) {
      try {
        // get all versions of all document types
        const documentVersions = await Promise.all(
          documentTypes.map((t) => this.kycApi.getDocumentVersion(userDataList[key].id, t)),
        ).then((versions) => versions.filter((v) => v).reduce((prev, curr) => prev.concat(curr), []));
        if (!documentVersions?.length) continue;

        const customer = await this.kycApi.getCustomer(userDataList[key].id);
        const isCompleted = documentVersions.find((doc) => doc.state === State.COMPLETED) != null;
        const isFailed =
          documentVersions.find((doc) => doc.state != State.FAILED && this.dateDiffInDays(doc.creationTime) < 7) ==
          null;

        const shouldBeReminded =
          !isFailed &&
          this.dateDiffInDays(documentVersions[0].creationTime) > 2 &&
          this.dateDiffInDays(documentVersions[0].creationTime) < 7;

        if (isCompleted) {
          console.log(
            `KYC change: Changed status of user ${userDataList[key].id} from ${userDataList[key].kycStatus} to ${nextStatus}`,
          );
          userDataList[key].kycStatus = nextStatus;
          userDataList[key].kycState = KycState.NA;
          userDataList[key] = await updateAction(userDataList[key], customer);
        } else if (isFailed && userDataList[key].kycState != KycState.FAILED) {
          if (userDataList[key].kycStatus === KycStatus.WAIT_ONLINE_ID) {
            await this.userDataService.initiateIdentification(
              userDataList[key],
              false,
              KycDocument.INITIATE_VIDEO_IDENTIFICATION,
            );
            await this.mailService.sendOnlineFailedMail(
              customer.names[0].firstName,
              customer.emails[0],
              userDataList[key]?.language?.symbol?.toLocaleLowerCase(),
            );

            console.log(
              `KYC change: Changed status of user ${userDataList[key].id} from status ${userDataList[key].kycStatus} to ${KycStatus.WAIT_VIDEO_ID}`,
            );
            userDataList[key].kycStatus = KycStatus.WAIT_VIDEO_ID;
            userDataList[key].kycState = KycState.NA;
          } else {
            await this.mailService.sendSupportFailedMail(userDataList[key], customer.id);
            console.log(
              `KYC change: Changed state of user ${userDataList[key].id} with status ${userDataList[key].kycStatus} from ${userDataList[key].kycState} to ${KycState.FAILED}`,
            );
            userDataList[key].kycState = KycState.FAILED;
          }
        } else if (shouldBeReminded && ![KycState.REMINDED, KycState.RETRIED].includes(userDataList[key].kycState)) {
          await this.mailService.sendReminderMail(customer.names[0].firstName, customer.emails[0], currentStatus);
          console.log(
            `KYC change: Changed state of user ${userDataList[key].id} with status ${userDataList[key].kycStatus} from ${userDataList[key].kycState} to ${KycState.REMINDED}`,
          );
          userDataList[key].kycState = KycState.REMINDED;
        }
        await this.userDataRepo.save(userDataList[key]);
      } catch (e) {
        console.error('Exception during KYC checks:', e);
        await this.mailService.sendErrorMail('KYC Error', [e]);
      }
    }
  }

  private dateDiffInDays(creationTime: number) {
    const timeDiff = new Date().getTime() - new Date(creationTime).getTime();
    return timeDiff / (1000 * 3600 * 24);
  }
}
