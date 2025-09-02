import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Recall } from './recall.entity';

@Injectable()
export class RecallRepository extends BaseRepository<Recall> {
  constructor(manager: EntityManager) {
    super(Recall, manager);
  }
}
