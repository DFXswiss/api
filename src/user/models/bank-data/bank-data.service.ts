import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BankDataRepository } from 'src/user/models/bank-data/bank-data.repository';
import { BankDataDto } from 'src/user/models/bank-data/dto/bank-data.dto';
import { UserData } from 'src/user/models/userData/userData.entity';
import { UserDataRepository } from 'src/user/models/userData/userData.repository';
import { KycApiService } from 'src/user/services/kyc/kyc-api.service';

@Injectable()
export class BankDataService {
  constructor(
    private readonly userDataRepo: UserDataRepository,
    private readonly bankDataRepo: BankDataRepository,
    private kycApiService: KycApiService,
  ) {}

  async addBankData(userDataId: number, bankDataDto: BankDataDto): Promise<UserData> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId }, relations: ['bankDatas'] });
    if (!userData) throw new NotFoundException(`No user data for id ${userDataId}`);

    const bankDataCheck = await this.bankDataRepo.findOne({
      iban: bankDataDto.iban,
      location: bankDataDto.location ?? null,
      name: bankDataDto.name,
    });
    if (bankDataCheck) throw new ConflictException('Bank data with duplicate key');

    const bankData = this.bankDataRepo.create({ ...bankDataDto, userData: userData });
    await this.bankDataRepo.save(bankData);

    const customer = await this.kycApiService.getCustomer(userData.id);

    if (!customer) {
      await this.kycApiService.createCustomer(userData.id, bankData.name);
    }

    userData.bankDatas.push(bankData);

    return userData;
  }

  async updateBankData(bankDataId: number, newBankData: BankDataDto): Promise<any> {
    try {
      const bankData = await this.bankDataRepo.findOne({
        id: bankDataId,
      });

      if (!bankData) throw new NotFoundException('No matching bankdata for id found');

      return this.bankDataRepo.save({ ...bankData, ...newBankData });
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async deleteBankData(bankDataId: number): Promise<any> {
    try {
      const bankData = await this.bankDataRepo.delete({
        id: bankDataId,
      });

      if (!bankData) throw new NotFoundException('No matching bank data for id found');

      return true;
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }
}
