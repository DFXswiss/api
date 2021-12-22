import { Injectable, NotFoundException } from '@nestjs/common';
import { UpdateUserDataDto } from './dto/update-userData.dto';
import { UserDataRepository } from './userData.repository';
import { KycState, KycStatus, UserData } from './userData.entity';
import { ChatBotResponse, CheckResult, Customer, IdentificationResponse } from 'src/user/services/kyc/dto/kyc.dto';
import { BankDataRepository } from 'src/user/models/bankData/bankData.repository';
import { UserRepository } from 'src/user/models/user/user.repository';
import { MailService } from 'src/shared/services/mail.service';
import { KycApiService } from 'src/user/services/kyc/kyc-api.service';

export interface UserDataChecks {
  userDataId: string;
  customerId?: string;
  kycFileReference?: string;
  nameCheckRisk: string;
  activationDate: Date;
  kycStatus: KycStatus;
}

export interface CustomerDataDetailed {
  customer: Customer;
  checkResult: CheckResult;
}

@Injectable()
export class UserDataService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly userDataRepo: UserDataRepository,
    private readonly bankDataRepo: BankDataRepository,
    private readonly mailService: MailService,
    private readonly kycApi: KycApiService,
  ) {}

  async getUserData(name: string, location: string): Promise<UserData> {
    const bankData = await this.bankDataRepo.findOne({ where: { name, location }, relations: ['userData'] });
    if (!bankData) throw new NotFoundException(`No user data for name ${name} and location ${location}`);

    return bankData.userData;
  }

  async updateUserData(updatedUser: UpdateUserDataDto): Promise<UserData> {
    if (updatedUser.kycStatus && !updatedUser.kycState) {
      updatedUser.kycState = KycState.NA;
    }

    const userData = await this.userDataRepo.findOne(updatedUser.id);
    if (!userData) throw new NotFoundException('No user for id found');

    if (updatedUser.mainBankDataId) {
      const bankData = await this.bankDataRepo.findOne(updatedUser.mainBankDataId);
      if (!bankData) throw new NotFoundException(`No bank data for id ${updatedUser.mainBankDataId} found`);
      userData.mainBankData = bankData;
    }

    if (updatedUser.depositLimit) userData.depositLimit = updatedUser.depositLimit;
    if (updatedUser.kycStatus) userData.kycStatus = updatedUser.kycStatus;
    if (updatedUser.kycState) userData.kycState = updatedUser.kycState;

    return await this.userDataRepo.save(userData);
  }

  async getAllUserData(): Promise<UserData[]> {
    return this.userDataRepo.getAllUserData();
  }

  async getAllCustomer(): Promise<any> {
    return this.kycApi.getAllCustomer();
  }

  async getCustomer(userDataId: number): Promise<CustomerDataDetailed> {
    const customer = await this.kycApi.getCustomer(userDataId);
    if (!customer) return null;

    const checkResult = await this.kycApi.getCheckResult(userDataId);
    return { customer: customer, checkResult: checkResult };
  }

  async doNameCheck(userDataId: number): Promise<string> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId } });
    if (!userData) throw new NotFoundException(`No user data for id ${userDataId}`);
    const kycData = await this.kycApi.getCustomer(userData.id);
    if (!kycData) throw new NotFoundException(`User with id ${userDataId} is not in spider`);
    await this.kycApi.checkCustomer(userData.id);
    const resultNameCheck = await this.kycApi.getCheckResult(userData.id);

    // save
    await this.userDataRepo.save(userData);

    return resultNameCheck?.risks?.[0]?.categoryKey;
  }

  async getCheckStatus(userDataId: number): Promise<string> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId } });
    if (!userData) throw new NotFoundException(`No user data for id ${userDataId}`);
    const kycData = await this.kycApi.getCustomer(userData.id);
    if (!kycData) throw new NotFoundException(`User with id ${userDataId} is not in spider`);

    const resultNameCheck = await this.kycApi.getCheckResult(userData.id);
    return resultNameCheck?.risks?.[0]?.categoryKey;
  }

  async getManyCheckStatus(startUserDataId: number, endUserDataId: number): Promise<UserDataChecks[]> {
    const userDataChecks: UserDataChecks[] = [];
    for (let userDataId = startUserDataId; userDataId <= endUserDataId; userDataId++) {
      const userData = await this.userDataRepo.findOne({ where: { id: userDataId } });
      const customer = await this.getCustomer(userDataId);
      if (customer) {
        userDataChecks.push({
          userDataId: userDataId.toString(),
          customerId: customer.customer.id.toString(),
          kycFileReference: userData?.kycFile?.id.toString() ?? null,
          nameCheckRisk: customer.checkResult?.risks[0].categoryKey,
          activationDate: customer.customer.activationDate
            ? new Date(
                +customer.customer.activationDate.year,
                +customer.customer.activationDate.month - 1,
                +customer.customer.activationDate.day,
              )
            : null,
          kycStatus: userData?.kycStatus,
        });
      } else {
        userDataChecks.push({
          userDataId: userDataId.toString(),
          customerId: null,
          kycFileReference: userData?.kycFile?.id.toString() ?? null,
          nameCheckRisk: null,
          activationDate: null,
          kycStatus: userData?.kycStatus,
        });
      }
    }

    return userDataChecks;
  }

  async requestKyc(userId: number, depositLimit?: string): Promise<boolean | ChatBotResponse> {
    const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['userData'] });
    const userData = user.userData;

    if (userData?.kycStatus === KycStatus.NA) {
      const kycUser = await this.kycApi.getCustomer(userData.id);
      // update customer
      const kycUserNew = await this.kycApi.updateCustomer(userData.id, user);

      if (!kycUser && kycUserNew) await this.kycApi.checkCustomer(userData.id);
      // start onboarding
      const chatBotData = await this.kycApi.initiateOnboardingChatBot(userData.id, false);
      // set status to chatbot
      if (chatBotData) userData.kycStatus = KycStatus.WAIT_CHAT_BOT;
      await this.userDataRepo.save(userData);
      return chatBotData;
    } else if (userData?.kycStatus === KycStatus.WAIT_CHAT_BOT && userData?.kycState === KycState.FAILED) {
      // change state back to NA
      userData.kycState = KycState.NA;
      // start onboarding
      const chatBotData = await this.kycApi.initiateOnboardingChatBot(userData.id, false);
      await this.userDataRepo.save(userData);
      return chatBotData;
    } else if (userData?.kycStatus === KycStatus.WAIT_VIDEO_ID && userData?.kycState === KycState.FAILED) {
      // change state back to NA
      userData.kycState = KycState.NA;
      // initiate video identification
      await this.kycApi.initiateVideoIdentification(userData.id);
      await this.userDataRepo.save(userData);
      return true;
    } else if (userData?.kycStatus === KycStatus.COMPLETED || userData?.kycStatus === KycStatus.WAIT_MANUAL) {
      const customer = await this.kycApi.getCustomer(userData.id);
      // send mail to support
      await this.mailService.sendLimitSupportMail(userData, customer.id, depositLimit);
      return true;
    }
    return false;
  }

  async mergeUserData(masterId: number, slaveId: number): Promise<void> {
    const [master, slave] = await Promise.all([
      this.userDataRepo.findOne({ where: { id: masterId }, relations: ['users', 'bankDatas'] }),
      this.userDataRepo.findOne({ where: { id: slaveId }, relations: ['users', 'bankDatas'] }),
    ]);

    master.bankDatas = master.bankDatas.concat(slave.bankDatas);
    master.users = master.users.concat(slave.users);
    await this.userDataRepo.save(master);
  }
}
