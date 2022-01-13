import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { KycState, KycStatus, UserData } from 'src/user/models/userData/userData.entity';
import { UserDataRepository } from 'src/user/models/userData/userData.repository';
import { MailService } from '../../../shared/services/mail.service';
import { KycApiService } from './kyc-api.service';
import { Customer, KycDocument, State } from './dto/kyc.dto';
import { SpiderDataRepository } from 'src/user/models/spider-data/spider-data.repository';

@Injectable()
export class KycSchedulerService {
  constructor(
    private mailService: MailService,
    private userDataRepo: UserDataRepository,
    private kycApi: KycApiService,
    private spiderDataRepo: SpiderDataRepository,
  ) {}

  @Interval(300000)
  async doChecks() {
    try {
      await this.doChatBotCheck();
      await this.doOnlineIdCheck();
      await this.doVideoIdCheck();
    } catch (e) {
      console.error('Exception during KYC checks:', e);
      await this.mailService.sendErrorMail('KYC error', [e]);
    }
  }

  private async doChatBotCheck(): Promise<void> {
    await this.doCheck(KycStatus.WAIT_CHAT_BOT, KycStatus.WAIT_ONLINE_ID, [KycDocument.CHATBOT], async (userData) => {
      userData.riskState = await this.kycApi.getCheckResult(userData.id);
      const spiderData = await this.spiderDataRepo.findOne({ userData: { id: userData.id } });
      const chatBotResult = await this.kycApi.downloadCustomerDocumentVersionParts(
        userData.id,
        KycDocument.CHATBOT_ONBOARDING,
        spiderData.version,
      );

      spiderData.result = JSON.stringify(chatBotResult);
      const formItems = JSON.parse(chatBotResult?.attributes?.form)?.items;

      userData.contributionAmount = formItems['global.contribution']?.value?.split(' ')[1];
      userData.contributionCurrency = formItems['global.contribution']?.value?.split(' ')[0];
      userData.plannedContribution = formItems['global.plannedDevelopmentOfAssets']?.value?.en;

      await this.spiderDataRepo.save(spiderData);
      await this.userDataRepo.save(userData);

      await this.kycApi.initiateOnlineIdentification(userData.id);

      return userData;
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
            await this.kycApi.initiateVideoIdentification(userDataList[key].id);
            console.log(
              `KYC change: Changed status of user ${userDataList[key].id} from status ${userDataList[key].kycStatus} to ${KycStatus.WAIT_VIDEO_ID}`,
            );
            userDataList[key].kycStatus = KycStatus.WAIT_VIDEO_ID;
            userDataList[key].kycState = KycState.NA;
          } else if (
            userDataList[key].kycStatus === KycStatus.WAIT_VIDEO_ID &&
            userDataList[key].kycState != KycState.RETRIED
          ) {
            await this.kycApi.initiateVideoIdentification(userDataList[key].id);
            console.log(
              `KYC change: Changed state of user ${userDataList[key].id} with status ${userDataList[key].kycStatus} from ${userDataList[key].kycState} to ${KycState.RETRIED}`,
            );
            userDataList[key].kycState = KycState.RETRIED;
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
        await this.userDataRepo.save(userDataList);
      } catch (e) {
        console.error('Exception during KYC checks:', e);
        await this.mailService.sendErrorMail('KYC error', [e]);
      }
    }
  }

  private dateDiffInDays(creationTime: number) {
    const timeDiff = new Date().getTime() - new Date(creationTime).getTime();
    return timeDiff / (1000 * 3600 * 24);
  }
}
