import { Injectable, NotFoundException } from '@nestjs/common';
import { UpdateUserDataDto } from './dto/update-userData.dto';
import { UserDataRepository } from './userData.repository';
import { KycStatus, UserData } from './userData.entity';
import { KycService } from 'src/services/kyc.service';
import { BankDataRepository } from 'src/bankData/bankData.repository';
import { UserRepository } from 'src/user/user.repository';

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
    const customer = await this.kycService.getAllCustomer();
    return customer;
  }

  async getCustomer(userDataId: number): Promise<any> {
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

    const customerInformation = await this.kycService.getCustomerInformation(userData.id);
    const resultNameCheck = await this.kycService.getCheckResult(customerInformation.lastCheckId);
    return resultNameCheck.risks[0].categoryKey;
  }

  async requestKyc(userId: number): Promise<UserData> {
    const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['userData'] });
    const userData = user.userData;

    if (userData?.kycStatus === KycStatus.NA) {
      // update customer
      await this.kycService.updateCustomer(userData.id, user);

      userData.kycFileReference = await this.userDataRepo.getNextKycFileId();

      // start onboarding
      const chatBotData = await this.kycService.onboardingCustomer(userData.id);

      if (chatBotData) userData.kycStatus = KycStatus.WAIT_CHAT_BOT;
      await this.userDataRepo.save(userData);
    }
    return userData;
  }
}
