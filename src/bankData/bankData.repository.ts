import { EntityRepository, Repository } from 'typeorm';
import { BankData } from './bankData.entity';

@EntityRepository(BankData)
export class BankDataRepository extends Repository<BankData> { }
