import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BankDataRepository } from 'src/bankData/bankData.repository';
import { BankDataDto } from 'src/bankData/dto/bankData.dto';
import { KycService } from 'src/services/kyc.service';
import { UserData } from 'src/userData/userData.entity';
import { UserDataRepository } from 'src/userData/userData.repository';

@Injectable()
export class BankDataService {
  constructor(
    private readonly userDataRepo: UserDataRepository,
    private readonly bankDataRepo: BankDataRepository,
    private kycService: KycService,
  ) {}

  async addBankData(userDataId: number, bankDataDto: BankDataDto): Promise<UserData> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId }, relations: ['bankDatas'] });
    if (!userData) throw new NotFoundException(`No user data for id ${userDataId}`);

    const bankData = this.bankDataRepo.create({ ...bankDataDto, userData: userData });

    try {
      await this.bankDataRepo.save(bankData);
    } catch (e) {
      throw new ConflictException(e.message);
    }

    const customer = await this.kycService.getCustomer(userData.id);

    if (!customer) {
      await this.kycService.createCustomer(userData.id, bankData.name);
    }

    userData.bankDatas.push(bankData);

    return userData;
  }
}
