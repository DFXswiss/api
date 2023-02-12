import { EntityRepository, Repository } from 'typeorm';
import { Sell } from './sell.entity';

@EntityRepository(Sell)
export class SellRepository extends Repository<Sell> {}
