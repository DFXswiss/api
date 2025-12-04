import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { VirtualIban } from './virtual-iban.entity';

@Injectable()
export class VirtualIbanRepository extends BaseRepository<VirtualIban> {
  constructor(manager: EntityManager) {
    super(VirtualIban, manager);
  }
}
