import { EntityRepository, Repository } from 'typeorm';
import { BankTxRepeat } from './bank-tx-repeat.entity';

@EntityRepository(BankTxRepeat)
export class BankTxRepeatRepository extends Repository<BankTxRepeat> {}
