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

  async doNameCheck(userDataId: number): Promise<NameCheckStatus> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId }, relations: ['bankDatas'] });
    if (!userData) throw new NotFoundException(`No user data for id ${userDataId}`);
    if (userData.bankDatas.length == 0) throw new NotFoundException(`User with id ${userDataId} has no bank data`);

    // check the name
    const nameToCheck = userData.bankDatas[0].name;
    userData.kycCustomerId = await this.kycService.createCustomer(userData.id, nameToCheck);
    userData.nameCheck = (await this.kycService.checkCustomer(userData.id))
      ? NameCheckStatus.SAFE
      : NameCheckStatus.WARNING;

    // save
    await this.userDataRepo.save(userData);

    return userData.nameCheck;
  }

  async requestKyc(userId: number): Promise<UserData> {
    const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['userData'] });
    const userData = await user.userData;

    if (userData.kycStatus != KycStatus.NA) throw new ConflictException('User is already applying for or has KYC');

    userData.kycFileReference = await this.userDataRepo.getNextKycFileId();
    userData.kycRequestDate = new Date();
    userData.kycStatus = KycStatus.PROCESSING;

    await this.userDataRepo.save(userData);

    await this.mailService.sendKycRequestMail(userData);

    return userData;
  }
}
