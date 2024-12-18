import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { BankData } from './bank-data.entity';

@Injectable()
export class BankDataRepository extends BaseRepository<BankData> {
  constructor(manager: EntityManager) {
    super(BankData, manager);
  }

  async saveAsDefault(bankData: BankData): Promise<BankData> {
    if (bankData.userData) {
      await this.update({ userData: bankData.userData, default: true }, { default: false });
    }

    return super.save(bankData);
  }

  async updateAsDefault(criteria: any, partialEntity: Partial<BankData>): Promise<any> {
    if (partialEntity.default) {
      const entity = await this.findOne({ where: criteria });
      if (!entity) throw new Error('Entity not found for updateAsDefault');

      await this.update({ userData: entity.userData, default: true }, { default: false });
    }

    return super.update(criteria, partialEntity);
  }

  async clearDefault(userDataId: number): Promise<any> {
    return this.update({ userData: { id: userDataId }, default: true }, { default: false });
  }
}
