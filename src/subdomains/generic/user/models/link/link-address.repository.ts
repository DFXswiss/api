import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { LinkAddress } from './link-address.entity';

@Injectable()
export class LinkAddressRepository extends BaseRepository<LinkAddress> {
  constructor(manager: EntityManager) {
    super(LinkAddress, manager);
  }
}
