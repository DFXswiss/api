import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BankDataRepository } from 'src/subdomains/generic/user/models/bank-data/bank-data.repository';
import { BankDataDto } from 'src/subdomains/generic/user/models/bank-data/dto/bank-data.dto';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataRepository } from 'src/subdomains/generic/user/models/user-data/user-data.repository';
import { SpiderService } from 'src/subdomains/generic/user/services/spider/spider.service';
import { BankData } from './bank-data.entity';

@Injectable()
export class BankDataService {
  constructor(
    private readonly userDataRepo: UserDataRepository,
    private readonly bankDataRepo: BankDataRepository,
    private readonly spiderService: SpiderService,
  ) {}

  async addBankData(userDataId: number, dto: BankDataDto): Promise<UserData> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId }, relations: ['bankDatas'] });
    if (!userData) throw new NotFoundException('User data not found');

    const bankDataCheck = await this.bankDataRepo.findOneBy({
      iban: dto.iban,
      name: dto.name,
    });
    if (bankDataCheck) throw new ConflictException('Bank data already exists');

    const bankData = this.bankDataRepo.create({ ...dto, userData });
    await this.bankDataRepo.save(bankData);

    // create customer and do name check, if not existing
    const created = await this.spiderService.createCustomer(userData.id, bankData.name);
    if (created) {
      userData.riskResult = await this.spiderService.checkCustomer(userData.id);
      await this.userDataRepo.save(userData);
    } else {
      // update updated time in user data
      await this.userDataRepo.setNewUpdateTime(userDataId);
    }

    userData.bankDatas.push(bankData);
    return userData;
  }

  async updateBankData(id: number, dto: BankDataDto): Promise<BankData> {
    const bankData = await this.bankDataRepo.findOneBy({ id });
    if (!bankData) throw new NotFoundException('Bank data not found');

    return this.bankDataRepo.save({ ...bankData, ...dto });
  }

  async deleteBankData(id: number): Promise<void> {
    await this.bankDataRepo.delete(id);
  }
}
