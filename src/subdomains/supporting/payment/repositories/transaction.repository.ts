import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Transaction } from '../entities/transaction.entity';

@Injectable()
export class TransactionRepository extends BaseRepository<Transaction> {
  constructor(manager: EntityManager) {
    super(Transaction, manager);
  }
}
