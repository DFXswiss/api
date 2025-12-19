import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { VirtualIban } from './virtual-iban.entity';

@Injectable()
export class VirtualIbanRepository extends CachedRepository<VirtualIban> {
  constructor(manager: EntityManager) {
    super(VirtualIban, manager);
  }
}
