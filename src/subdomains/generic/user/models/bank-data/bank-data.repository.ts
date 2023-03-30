import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { BankData } from './bank-data.entity';

@Injectable()
export class BankDataRepository extends BaseRepository<BankData> {
  constructor(manager: EntityManager) {
    super(BankData, manager);
  }
}
