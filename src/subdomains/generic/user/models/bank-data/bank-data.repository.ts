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

  async updateWithUniqueDefault(criteria: any, update: Partial<BankData>): Promise<any> {
    if (update.default) {
      const entity = await this.findOne({ where: criteria });
      if (!entity) throw new Error('Entity not found');

      await this.clearDefault(entity.userData);
    }

    return super.update(criteria, update);
  }

  async clearDefault(userData: UserData): Promise<void> {
    const currentDefault = await this.findOne({ where: { userData: { id: userData.id }, default: true } });
    if (currentDefault) await super.save({ ...currentDefault, default: false });
  }
}
