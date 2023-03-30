import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { BankTxRepeat } from './bank-tx-repeat.entity';

@Injectable()
export class BankTxRepeatRepository extends BaseRepository<BankTxRepeat> {
  constructor(manager: EntityManager) {
    super(BankTxRepeat, manager);
  }
}
