import { EntityRepository, Repository } from 'typeorm';
import { LimitRequest } from './limit-request.entity';

@EntityRepository(LimitRequest)
export class LimitRequestRepository extends Repository<LimitRequest> {}
