import { EntityRepository, Repository } from 'typeorm';
import { BankData } from './bank-data.entity';

@EntityRepository(BankData)
export class BankDataRepository extends Repository<BankData> {}
