import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Masternode } from './masternode.entity';

@Injectable()
export class MasternodeRepository extends BaseRepository<Masternode> {
  constructor(manager: EntityManager) {
    super(Masternode, manager);
  }
}
