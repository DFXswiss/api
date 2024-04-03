import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BankDataRepository } from 'src/subdomains/generic/user/models/bank-data/bank-data.repository';
import { CreateBankDataDto } from 'src/subdomains/generic/user/models/bank-data/dto/create-bank-data.dto';
import { UserData, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataRepository } from 'src/subdomains/generic/user/models/user-data/user-data.repository';
import { Not } from 'typeorm';
import { BankData } from './bank-data.entity';
import { UpdateBankDataDto } from './dto/update-bank-data.dto';

@Injectable()
export class BankDataService {
  constructor(private readonly userDataRepo: UserDataRepository, private readonly bankDataRepo: BankDataRepository) {}

  async addBankData(userDataId: number, dto: CreateBankDataDto): Promise<UserData> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId }, relations: ['bankDatas'] });
    if (!userData) throw new NotFoundException('User data not found');
    if (userData.status === UserDataStatus.MERGED) throw new BadRequestException('User data is merged');

    return this.createBankData(userData, dto);
  }

  async createBankData(userData: UserData, dto: CreateBankDataDto): Promise<UserData> {
    const bankData = this.bankDataRepo.create({ ...dto, userData });
    await this.bankDataRepo.save(bankData);

    // update updated time in user data
    await this.userDataRepo.setNewUpdateTime(userData.id);

    userData.bankDatas.push(bankData);
    return userData;
  }

  async updateBankData(id: number, dto: UpdateBankDataDto): Promise<BankData> {
    const bankData = await this.bankDataRepo.findOneBy({ id });
    if (!bankData) throw new NotFoundException('Bank data not found');

    if (dto.active) {
      const activeBankData = await this.bankDataRepo.findOneBy({
        id: Not(bankData.id),
        iban: bankData.iban,
        active: true,
      });
      if (activeBankData) throw new BadRequestException('Active bankData with same iban found');
    }

    return this.bankDataRepo.save({ ...bankData, ...dto });
  }

  async deleteBankData(id: number): Promise<void> {
    await this.bankDataRepo.delete(id);
  }

  async getBankData(id: number): Promise<BankData> {
    return this.bankDataRepo.findOne({ where: { id }, relations: { userData: true } });
  }

  async getBankDatasForUser(userDataId: number): Promise<BankData[]> {
    return this.bankDataRepo.findBy({ userData: { id: userDataId }, active: true });
  }

  async getBankDataWithIban(iban: string, userDataId?: number): Promise<BankData> {
    if (!iban) return undefined;
    return this.bankDataRepo
      .find({
        where: { iban, userData: { id: userDataId } },
        relations: ['userData'],
      })
      .then((b) => b.filter((b) => b.active)[0] ?? b[0]);
  }
}
