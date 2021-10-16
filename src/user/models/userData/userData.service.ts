import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { UpdateUserDataDto } from './dto/update-userData.dto';
import { UserDataRepository } from './userData.repository';
import { KycStatus, UserData } from './userData.entity';
import { CheckResult, Customer, KycService } from 'src/user/services/kyc.service';
import { BankDataRepository } from 'src/user/models/bankData/bankData.repository';
import { UserRepository } from 'src/user/models/user/user.repository';
import { MailService } from 'src/shared/services/mail.service';

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
    private readonly kycService: KycService,
    private readonly mailService: MailService,
  ) {}

  async getUserData(name: string, location: string): Promise<UserData> {
    const bankData = await this.bankDataRepo.findOne({ where: { name, location }, relations: ['userData'] });
    if (!bankData) throw new NotFoundException(`No user data for name ${name} and location ${location}`);

    return bankData.userData;
  }

  async updateUserData(newUser: UpdateUserDataDto): Promise<any> {
    return this.userDataRepo.updateUserData(newUser);
  }

  async getAllUserData(): Promise<any> {
    return this.userDataRepo.getAllUserData();
  }

  async getAllCustomer(): Promise<any> {
    return this.kycService.getAllCustomer();
  }

  async getCustomer(userDataId: number): Promise<CustomerDataDetailed> {
    const customer = await this.kycService.getCustomer(userDataId);
    if (!customer) return null;

    const customerInformation = await this.kycService.getCustomerInformation(userDataId);
    const checkResult = await this.kycService.getCheckResult(customerInformation.lastCheckId);
    return { customer: customer, checkResult: checkResult };
  }

  async doNameCheck(userDataId: number): Promise<string> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId }, relations: ['bankDatas'] });
    if (!userData) throw new NotFoundException(`No user data for id ${userDataId}`);
    if (userData.bankDatas.length == 0) throw new NotFoundException(`User with id ${userDataId} has no bank data`);

    const nameCheck = await this.kycService.checkCustomer(userData.id);
    const resultNameCheck = await this.kycService.getCheckResult(nameCheck.checkId);

    // save
    await this.userDataRepo.save(userData);

    return resultNameCheck.risks[0].categoryKey;
  }

  async getCheckStatus(userDataId: number): Promise<string> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId }, relations: ['bankDatas'] });
    if (!userData) throw new NotFoundException(`No user data for id ${userDataId}`);
    if (userData.bankDatas.length == 0) throw new NotFoundException(`User with id ${userDataId} has no bank data`);

    let customerInformation = null;
    let resultNameCheck = null;

    try {
      customerInformation = await this.kycService.getCustomerInformation(userData.id);
    } catch (error) {
      throw new ServiceUnavailableException('Customer information error: ' + error.message);
    }

    try {
      resultNameCheck = await this.kycService.getCheckResult(customerInformation.lastCheckId);
    } catch (error) {
      throw new ServiceUnavailableException('Customer check error: ' + error.message);
    }

    return resultNameCheck.risks[0].categoryKey;
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
          nameCheckRisk: customer.checkResult.risks[0].categoryKey,
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

  async requestKyc(userDataId: number): Promise<boolean> {
    const user = await this.userRepo.findOne({ where: { userData: userDataId }, relations: ['userData'] });
    const userData = user.userData;

    if (userData?.kycStatus === KycStatus.NA) {
      // update customer
      await this.kycService.updateCustomer(userData.id, user);

      // start onboarding
      const chatBotData = await this.kycService.initiateOnboardingChatBot(userData.id);

      if (chatBotData) userData.kycStatus = KycStatus.WAIT_CHAT_BOT;
      await this.userDataRepo.save(userData);
      return true;
    } else if (userData?.kycStatus === KycStatus.COMPLETED || userData?.kycStatus === KycStatus.WAIT_MANUAL) {
      const customer = await this.kycService.getCustomer(userData.id);
      await this.mailService.sendLimitSupportMail(userData, customer.id);
    } else {
      return false;
    }
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
