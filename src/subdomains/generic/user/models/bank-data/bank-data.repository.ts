import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { UserData } from '../user-data/user-data.entity';
import { BankData } from './bank-data.entity';

@Injectable()
export class BankDataRepository extends BaseRepository<BankData> {
  constructor(manager: EntityManager) {
    super(BankData, manager);
  }

  async saveWithDefault(bankData: BankData): Promise<BankData> {
    if (bankData.default) await this.clearDefault(bankData.userData);

    return super.save(bankData);
  }

  async updateWithDefault(criteria: any, update: Partial<BankData>): Promise<any> {
    if (update.default) {
      const entity = await this.findOne({ where: criteria });
      if (!entity) throw new Error('Entity not found for updateAsDefault');

      await this.clearDefault(entity.userData);
    }

    return super.update(criteria, update);
  }

  async clearDefault(userData: UserData): Promise<any> {
    return this.update({ userData, default: true }, { default: false });
  }
}
