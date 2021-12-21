import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { KycFile } from 'src/user/models/userData/kycFile.entity';
import { KycState, KycStatus, UserData } from 'src/user/models/userData/userData.entity';
import { UserDataRepository } from 'src/user/models/userData/userData.repository';
import { Repository } from 'typeorm';
import { MailService } from '../../../shared/services/mail.service';
import { KycApiService } from './kyc-api.service';
import { Customer, KycDocument, State } from './dto/kyc.dto';

@Injectable()
export class KycSchedulerService {
  constructor(
    private mailService: MailService,
    @InjectRepository(KycFile)
    private kycFileRepo: Repository<KycFile>,
    private userDataRepository: UserDataRepository,
    private kycApi: KycApiService,
  ) {}

  @Interval(300000)
  async doChecks() {
    try {
      await this.doChatBotCheck();
      //await this.doAddressCheck();
      await this.doOnlineIdCheck();
      await this.doVideoIdCheck();
    } catch (e) {
      console.error('Exception during KYC checks:', e);
      await this.mailService.sendErrorMail('Exception during KYC checks:', e);
    }
  }

  private async doChatBotCheck(): Promise<void> {
    await this.doCheck(KycStatus.WAIT_CHAT_BOT, KycStatus.WAIT_ONLINE_ID, [KycDocument.CHATBOT], async (userData) => {
      const resultNameCheck = await this.kycApi.getCheckResult(userData.id);
      if (['a', 'b'].includes(resultNameCheck?.risks?.[0].categoryKey)) {
        await this.kycApi.checkCustomer(userData.id);
      }
      await this.kycApi.initiateOnlineIdentification(userData.id);
      //await this.kycApi.initiateDocumentUpload(userData.id, [KycDocument.INVOICE]);
      return userData;
    });
  }

  private async doAddressCheck(): Promise<void> {
    await this.doCheck(KycStatus.WAIT_ADDRESS, KycStatus.WAIT_ONLINE_ID, [KycDocument.INVOICE], async (userData) => {
      await this.kycApi.initiateOnlineIdentification(userData.id);
      return userData;
    });
  }

  private async doOnlineIdCheck(): Promise<void> {
    await this.doCheck(
      KycStatus.WAIT_ONLINE_ID,
      KycStatus.WAIT_MANUAL,
      [KycDocument.ONLINE_IDENTIFICATION, KycDocument.VIDEO_IDENTIFICATION],
      (u, c) => this.createKycFile(u, c),
    );
  }

  private async doVideoIdCheck(): Promise<void> {
    await this.doCheck(
      KycStatus.WAIT_VIDEO_ID,
      KycStatus.WAIT_MANUAL,
      [KycDocument.VIDEO_IDENTIFICATION, KycDocument.ONLINE_IDENTIFICATION],
      (u, c) => this.createKycFile(u, c),
    );
  }

  private async createKycFile(userData: UserData, customer: Customer): Promise<UserData> {
    // create KYC file reference
    const kycFile = await this.kycFileRepo.save({ userData: userData });
    userData.kycFile = kycFile;
    await this.mailService.sendKycMail(userData, customer.names[0].firstName, customer.emails[0], customer.id);
    return userData;
  }

  private async doCheck(
    currentStatus: KycStatus,
    nextStatus: KycStatus,
    documentTypes: KycDocument[],
    updateAction: (userData: UserData, customer: Customer) => Promise<UserData>,
  ): Promise<void> {
    const userDataList = await this.userDataRepository.find({
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
        await this.userDataRepository.save(userDataList);
      } catch (e) {
        console.error('Exception during KYC checks:', e);
        await this.mailService.sendErrorMail('Exception during KYC checks:', e);
      }
    }
  }

  private dateDiffInDays(creationTime: number) {
    const timeDiff = new Date().getTime() - new Date(creationTime).getTime();
    return timeDiff / (1000 * 3600 * 24);
  }
}
