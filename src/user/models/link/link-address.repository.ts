import { EntityRepository, Repository } from 'typeorm';
import { LinkAddress } from './link-address.entity';

@EntityRepository(LinkAddress)
export class LinkAddressRepository extends Repository<LinkAddress> {}
