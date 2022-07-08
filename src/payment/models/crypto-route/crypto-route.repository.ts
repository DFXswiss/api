import { EntityRepository, Repository } from 'typeorm';
import { CryptoRoute } from './crypto-route.entity';

@EntityRepository(CryptoRoute)
export class CryptoRouteRepository extends Repository<CryptoRoute> {}
