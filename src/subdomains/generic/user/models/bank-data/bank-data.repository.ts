import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { DeepPartial, EntityManager } from 'typeorm';
import { UserData } from '../user-data/user-data.entity';
import { BankData } from './bank-data.entity';

@Injectable()
export class BankDataRepository extends BaseRepository<BankData> {
  constructor(manager: EntityManager) {
    super(BankData, manager);
  }

  async saveWithUniqueDefault(bankData: DeepPartial<BankData>): Promise<BankData> {
    if (bankData.default) await this.clearDefault(bankData.userData as UserData);

    return super.save(bankData);
  }

  async clearDefault(userData: UserData): Promise<void> {
    await this.update({ userData: { id: userData.id }, default: true }, { default: false });
  }
}
