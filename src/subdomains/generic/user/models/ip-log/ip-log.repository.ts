import { EntityRepository, Repository } from 'typeorm';
import { IpLog } from './ip-log.entity';

@EntityRepository(IpLog)
export class IpRepository extends Repository<IpLog> {}
