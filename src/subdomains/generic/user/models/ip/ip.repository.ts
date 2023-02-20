import { EntityRepository, Repository } from 'typeorm';
import { Ip } from './ip.entity';

@EntityRepository(Ip)
export class IpRepository extends Repository<Ip> {}
