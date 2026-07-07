import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { TransactionAmlCheck } from '../entities/transaction-aml-check.entity';

@Injectable()
export class TransactionAmlCheckRepository extends BaseRepository<TransactionAmlCheck> {
  constructor(manager: EntityManager) {
    super(TransactionAmlCheck, manager);
  }
}
