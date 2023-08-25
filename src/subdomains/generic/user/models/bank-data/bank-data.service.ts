import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BankDataRepository } from 'src/subdomains/generic/user/models/bank-data/bank-data.repository';
import { CreateBankDataDto } from 'src/subdomains/generic/user/models/bank-data/dto/create-bank-data.dto';
import { UserData, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataRepository } from 'src/subdomains/generic/user/models/user-data/user-data.repository';
import { SpiderService } from 'src/subdomains/generic/user/services/spider/spider.service';
import { Not } from 'typeorm';
import { BankData } from './bank-data.entity';
import { UpdateBankDataDto } from './dto/update-bank-data.dto';

@Injectable()
export class BankDataService {
  constructor(
    private readonly userDataRepo: UserDataRepository,
    private readonly bankDataRepo: BankDataRepository,
    private readonly spiderService: SpiderService,
  ) {}

  async addBankData(userDataId: number, dto: CreateBankDataDto): Promise<UserData> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId }, relations: ['bankDatas'] });
    if (!userData) throw new NotFoundException('User data not found');
    if (userData.status === UserDataStatus.MERGED) throw new BadRequestException('User data is merged');

    const bankData = this.bankDataRepo.create({ ...dto, userData });
    await this.bankDataRepo.save(bankData);

    // create customer and do name check, if not existing
    const created = await this.spiderService.createCustomer(userData.id, bankData.name);
    if (created) {
      userData.riskResult = await this.spiderService.checkCustomer(userData.id);
      await this.userDataRepo.update(userData.id, { riskState: userData.riskState, riskRoots: userData.riskRoots });
    } else {
      // update updated time in user data
      await this.userDataRepo.setNewUpdateTime(userDataId);
    }

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

  async getActiveBankDataWithIban(iban: string): Promise<BankData> {
    return this.bankDataRepo.findOne({
      where: { iban, active: true },
      relations: ['userData'],
    });
  }
}
