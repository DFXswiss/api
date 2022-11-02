import { EntityRepository, Repository } from 'typeorm';
import { BankTxBatch } from './bank-tx-batch.entity';

@EntityRepository(BankTxBatch)
export class BankTxBatchRepository extends Repository<BankTxBatch> {}
