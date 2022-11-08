import { EntityRepository, Repository } from 'typeorm';
import { Bank } from './bank.entity';

@EntityRepository(Bank)
export class BankRepository extends Repository<Bank> {}
