import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UpdateUserDataDto } from './dto/update-userData.dto';
import { UserDataRepository } from './userData.repository';
import { KycStatus, NameCheckStatus, UserData } from './userData.entity';
import { KycService } from 'src/services/kyc.service';
import { BankDataRepository } from 'src/bankData/bankData.repository';
import { UserRepository } from 'src/user/user.repository';
import { MailService } from 'src/services/mail.service';

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

  async doNameCheck(userDataId: number): Promise<NameCheckStatus> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId }, relations: ['bankDatas'] });
    if (!userData) throw new NotFoundException(`No user data for id ${userDataId}`);
    if (userData.bankDatas.length == 0) throw new NotFoundException(`User with id ${userDataId} has no bank data`);

    // check the name
    const nameToCheck = userData.bankDatas[0].name;
    userData.kycCustomerId = await this.kycService.createCustomer(userData.id, nameToCheck);

    const nameCheck = await this.kycService.checkCustomer(userData.id);

    if (nameCheck) {
      const resultNameCheck = await this.kycService.getCheckResult(nameCheck.checkId);

      switch (resultNameCheck.risks[0].categoryKey) {
        case 'a': {
          userData.nameCheck = NameCheckStatus.HIGHRISK;
          break;
        }
        case 'b': {
          userData.nameCheck = NameCheckStatus.WARNING;
          break;
        }
        case 'c': {
          userData.nameCheck = NameCheckStatus.SAFE;
          break;
        }
        default: {
          userData.nameCheck = NameCheckStatus.WARNING;
          break;
        }
      }
    }
    // save
    await this.userDataRepo.save(userData);

    return userData.nameCheck;
  }

  async requestKyc(userId: number): Promise<UserData> {
    const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['userData'] });
    const userData = user.userData;

    // update customer
    await this.kycService.updateCustomer(userData.id, user);
    userData.kycRequestDate = new Date();

    // start onboarding
    const chatBotData = await this.kycService.onboardingCustomer(userData.id);

    if (chatBotData) userData.kycStatus = KycStatus.WAIT_CHAT_BOT;
    await this.userDataRepo.save(userData);
    return userData;
  }
}
