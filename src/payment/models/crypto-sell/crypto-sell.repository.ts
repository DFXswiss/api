import { EntityRepository, Repository } from 'typeorm';
import { CryptoSell } from './crypto-sell.entity';

@EntityRepository(CryptoSell)
export class CryptoSellRepository extends Repository<CryptoSell> {}
