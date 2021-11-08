import { EntityRepository, Repository } from 'typeorm';
import { BankTx } from './bank-tx.entity';

@EntityRepository(BankTx)
export class BankTxRepository extends Repository<BankTx> {}
