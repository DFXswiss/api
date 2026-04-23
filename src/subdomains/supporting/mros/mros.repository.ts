import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Mros } from './mros.entity';

@Injectable()
export class MrosRepository extends BaseRepository<Mros> {
  constructor(manager: EntityManager) {
    super(Mros, manager);
  }
}
