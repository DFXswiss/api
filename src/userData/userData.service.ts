import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { UpdateUserDataDto } from './dto/update-userData.dto';
import { UserDataRepository } from './userData.repository';
import { KycStatus, UserData } from './userData.entity';
import { CheckResult, Customer, KycService } from 'src/services/kyc.service';
import { BankDataRepository } from 'src/bankData/bankData.repository';
import { UserRepository } from 'src/user/user.repository';

export interface UserDataChecks {
  userDataId: string;
  customerId?: string;
  kycFileReference?: string;
  nameCheckRisk: string;
  activationDate: Date;
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
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId }, relations: ['bankDatas'] });
    if (!userData) throw new NotFoundException(`No user data for id ${userDataId}`);
    if (userData.bankDatas.length == 0) throw new NotFoundException(`User with id ${userDataId} has no bank data`);

    const customer = await this.kycService.getCustomer(userData.id);
    const customerInformation = await this.kycService.getCustomerInformation(userData.id);
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
    try {
      const userDataChecks: UserDataChecks[] = [];
      for (let userDataId = startUserDataId; userDataId <= endUserDataId; userDataId++) {
        const userData = await this.userDataRepo.findOne({ where: { id: userDataId }, relations: ['bankDatas'] });
        if (userData) {
          if (userData.bankDatas.length > 0) {
            const customer = await this.getCustomer(userDataId);
            userDataChecks.push({
              userDataId: userDataId.toString(),
              customerId: customer.customer.id.toString(),
              kycFileReference: userData.kycFile?.id.toString() ?? null,
              nameCheckRisk: customer.checkResult.risks[0].categoryKey,
              activationDate: new Date(
                Number.parseInt(customer.customer.activationDate.year),
                Number.parseInt(customer.customer.activationDate.month) - 1,
                Number.parseInt(customer.customer.activationDate.day),
                2,
              ),
            });
          } else {
            userDataChecks.push({
              userDataId: userDataId.toString(),
              customerId: null,
              kycFileReference: null,
              nameCheckRisk: null,
              activationDate: null,
            });
          }
        }
      }
      return userDataChecks;
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async requestKyc(userDataId: number): Promise<boolean> {
    const user = await this.userRepo.findOne({ where: { userData: userDataId }, relations: ['userData'] });
    const userData = user.userData;

    if (userData?.kycStatus === KycStatus.NA) {
      // update customer
      const customer = await this.kycService.updateCustomer(userData.id, user);
      userData.kycCustomerId = customer.customerId;

      // start onboarding
      const chatBotData = await this.kycService.initiateOnboardingChatBot(userData.id);

      if (chatBotData) userData.kycStatus = KycStatus.WAIT_CHAT_BOT;
      await this.userDataRepo.save(userData);
      return true;
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
