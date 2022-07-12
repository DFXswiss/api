import { EntityRepository, Repository } from 'typeorm';
import { BuyFiat } from './buy-fiat.entity';

@EntityRepository(BuyFiat)
export class BuyFiatRepository extends Repository<BuyFiat> {}
