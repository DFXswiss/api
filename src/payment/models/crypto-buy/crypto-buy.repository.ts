import { EntityRepository, Repository } from 'typeorm';
import { CryptoBuy } from './crypto-buy.entity';

@EntityRepository(CryptoBuy)
export class CryptoBuyRepository extends Repository<CryptoBuy> {}
