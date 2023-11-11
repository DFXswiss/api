import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { BankTxReturn } from './bank-tx-return.entity';

@Injectable()
export class BankTxReturnRepository extends BaseRepository<BankTxReturn> {
  constructor(manager: EntityManager) {
    super(BankTxReturn, manager);
  }
}
