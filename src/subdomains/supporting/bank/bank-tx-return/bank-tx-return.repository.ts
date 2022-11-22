import { EntityRepository, Repository } from 'typeorm';
import { BankTxReturn } from './bank-tx-return.entity';

@EntityRepository(BankTxReturn)
export class BankTxReturnRepository extends Repository<BankTxReturn> {}
