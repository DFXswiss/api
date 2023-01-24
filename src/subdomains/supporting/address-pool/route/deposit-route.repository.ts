import { EntityRepository, Repository } from 'typeorm';
import { DepositRoute } from './deposit-route.entity';

@EntityRepository(DepositRoute)
export class DepositRouteRepository extends Repository<DepositRoute> {}
