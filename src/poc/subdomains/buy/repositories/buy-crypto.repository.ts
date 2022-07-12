import { EntityRepository, Repository } from 'typeorm';
import { PocBuyCrypto } from '../../../subdomains/buy/models/buy-crypto.entity';

@EntityRepository(PocBuyCrypto)
export class PocBuyCryptoRepository extends Repository<PocBuyCrypto> {}
