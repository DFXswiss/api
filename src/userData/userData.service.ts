import { Injectable, NotFoundException } from '@nestjs/common';
import { UpdateUserDataDto } from './dto/update-userData.dto';
import { UserDataRepository } from './userData.repository';
import { NameCheckStatus, UserData } from './userData.entity';
import { KycService } from 'src/services/kyc.service';
import { BankDataRepository } from 'src/bankData/bankData.repository';

@Injectable()
export class UserDataService {
  constructor(
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
    userData.nameCheck = (await this.kycService.doNameCheck(userData.id, nameToCheck))
      ? NameCheckStatus.SAFE
      : NameCheckStatus.WARNING;

    // save
    await this.userDataRepo.save(userData);

    return userData.nameCheck;
  }
}
