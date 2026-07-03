import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { ScorechainScreening } from '../entities/scorechain-screening.entity';

@Injectable()
export class ScorechainScreeningRepository extends BaseRepository<ScorechainScreening> {
  constructor(manager: EntityManager) {
    super(ScorechainScreening, manager);
  }
}
