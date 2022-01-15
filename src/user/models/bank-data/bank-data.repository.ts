import { ConflictException } from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { BankData } from './bank-data.entity';

@EntityRepository(BankData)
export class BankDataRepository extends Repository<BankData> {
  async getAllBankData(): Promise<any> {
    try {
      return await this.find({ relations: ['userData'] });
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }
}
