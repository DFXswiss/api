import { EntityRepository, Repository } from 'typeorm';
import { BuyCrypto } from '../entities/buy-crypto.entity';

@EntityRepository(BuyCrypto)
export class BuyCryptoRepository extends Repository<BuyCrypto> {}
