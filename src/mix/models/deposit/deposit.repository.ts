import { EntityRepository, Repository } from 'typeorm';
import { Deposit } from './deposit.entity';

@EntityRepository(Deposit)
export class DepositRepository extends Repository<Deposit> {}
