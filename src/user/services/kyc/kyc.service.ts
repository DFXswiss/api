import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { KycFile } from 'src/user/models/userData/kycFile.entity';
import { KycState, KycStatus, UserData } from 'src/user/models/userData/userData.entity';
import { UserDataRepository } from 'src/user/models/userData/userData.repository';
import { Repository } from 'typeorm';
import { MailService } from '../../../shared/services/mail.service';
import { KycApi } from './kyc.api';
import { Customer, KycDocument, State } from './dto/kyc.dto';

@Injectable()
export class KycService {
  constructor(
    private mailService: MailService,
    @InjectRepository(KycFile)
    private kycFileRepo: Repository<KycFile>,
    private userDataRepository: UserDataRepository,
    private kycApi: KycApi,
  ) {}

  @Interval(300000)
  async doChecks() {
    try {
      await this.doChatBotCheck();
      await this.doAddressCheck();
      await this.doOnlineIdCheck();
      await this.doVideoIdentCheck();
    } catch (e) {
      console.error('Exception during KYC checks:', e);
    }
  }

  async doChatBotCheck(): Promise<void> {
    await this.doCheck(KycStatus.WAIT_CHAT_BOT, KycStatus.WAIT_ADDRESS, KycDocument.CHATBOT, async (userData) => {
      const customerInformation = await this.kycApi.getCustomerInformation(userData.id);
      const resultNameCheck = await this.kycApi.getCheckResult(customerInformation.lastCheckId);
      if (resultNameCheck.risks[0].categoryKey === 'a' || resultNameCheck.risks[0].categoryKey === 'b') {
        await this.kycApi.checkCustomer(userData.id);
      }
      await this.kycApi.initiateDocumentUpload(userData.id, [KycDocument.INVOICE]);
      return userData;
    });
  }

  async doAddressCheck(): Promise<void> {
    await this.doCheck(KycStatus.WAIT_ADDRESS, KycStatus.WAIT_ONLINE_ID, KycDocument.INVOICE, async (userData) => {
      await this.kycApi.initiateOnlineIdentification(userData.id);
      return userData;
    });
  }

  async doOnlineIdCheck(): Promise<void> {
    await this.doCheck(KycStatus.WAIT_ONLINE_ID, KycStatus.WAIT_MANUAL, KycDocument.ONLINE_IDENTIFICATION, (u, c) =>
      this.createKycFile(u, c),
    );
  }

  async doVideoIdentCheck(): Promise<void> {
    await this.doCheck(KycStatus.WAIT_VIDEO_ID, KycStatus.WAIT_MANUAL, KycDocument.VIDEO_IDENTIFICATION, (u, c) =>
      this.createKycFile(u, c),
    );
  }

  private async createKycFile(userData: UserData, customer: Customer): Promise<UserData> {
    // create KYC file reference
    const kycFile = await this.kycFileRepo.save({ userData: userData });
    userData.kycFile = kycFile;

    //TODO: upload KYC file reference
    //await this.kycService.createFileReference(userData.id, userData.kycFileReference, user.surname);

    await this.mailService.sendKycMail(userData, customer.names[0].firstName, customer.emails[0], customer.id);
    return userData;
  }

  // --- HELPER METHODS --- //
  private reference(id: number): string {
    return process.env.KYC_PREFIX ? `${process.env.KYC_PREFIX}${id}` : id.toString();
  }

  private async doCheck(
    currentStatus: KycStatus,
    nextStatus: KycStatus,
    documentType: KycDocument,
    updateAction: (userData: UserData, customer: Customer) => Promise<UserData>,
  ): Promise<void> {
    const userDataList = await this.userDataRepository.find({
      where: { kycStatus: currentStatus },
    });
    for (const key in userDataList) {
      const documentVersions = await this.kycApi.getDocumentVersion(userDataList[key].id, documentType);
      if (!documentVersions?.length) continue;

      const customer = await this.kycApi.getCustomer(userDataList[key].id);
      const isCompleted = documentVersions.find((document) => document.state === State.COMPLETED) != null;
      const isFailed =
        documentVersions.find(
          (document) => document.state != State.FAILED && this.dateDiffInDays(document.creationTime) < 7,
        ) == null;
      const shouldBeReminded =
        !isFailed &&
        this.dateDiffInDays(documentVersions[0].creationTime) > 2 &&
        this.dateDiffInDays(documentVersions[0].creationTime) < 7;

      if (isCompleted) {
        userDataList[key].kycStatus = nextStatus;
        userDataList[key].kycState = KycState.NA;
        userDataList[key] = await updateAction(userDataList[key], customer);
      } else if (isFailed && userDataList[key].kycState != KycState.FAILED) {
        userDataList[key].kycState = KycState.FAILED;
        await this.mailService.sendSupportFailedMail(userDataList[key], customer.id);
      } else if (shouldBeReminded && userDataList[key].kycState != KycState.REMINDED) {
        userDataList[key].kycState = KycState.REMINDED;
        await this.mailService.sendReminderMail(customer.names[0].firstName, customer.emails[0], currentStatus);
      }
    }
    await this.userDataRepository.save(userDataList);
  }

  private dateDiffInDays(creationTime: number) {
    const timeDiff = new Date().getTime() - new Date(creationTime).getTime();
    return timeDiff / (1000 * 3600 * 24);
  }
}
