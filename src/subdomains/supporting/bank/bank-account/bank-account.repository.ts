import { EntityRepository, Repository } from 'typeorm';
import { BankAccount } from './bank-account.entity';

@EntityRepository(BankAccount)
export class BankAccountRepository extends Repository<BankAccount> {}
