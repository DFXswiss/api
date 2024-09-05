import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { BankTxBatch } from '../entities/bank-tx-batch.entity';

@Injectable()
export class BankTxBatchRepository extends BaseRepository<BankTxBatch> {
  constructor(manager: EntityManager) {
    super(BankTxBatch, manager);
  }
}
