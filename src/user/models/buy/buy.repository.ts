import { EntityRepository, Repository } from 'typeorm';
import { Buy } from './buy.entity';

@EntityRepository(Buy)
export class BuyRepository extends Repository<Buy> {}
