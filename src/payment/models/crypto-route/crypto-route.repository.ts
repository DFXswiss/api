import { EntityRepository, Repository } from 'typeorm';
import { CryptoRoute } from './crypto-route.entity';

@EntityRepository(CryptoRoute)
export class CryptoRepository extends Repository<CryptoRoute> {}
