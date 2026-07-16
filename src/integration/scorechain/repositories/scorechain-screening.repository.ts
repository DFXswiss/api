import { Injectable } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { ScorechainScreening } from '../entities/scorechain-screening.entity';

@Injectable()
export class ScorechainScreeningRepository extends BaseRepository<ScorechainScreening> {
  constructor(manager: EntityManager) {
    super(ScorechainScreening, manager);
  }

  // All persisted screenings whose objectId is in the given list, newest first. SQL-filtered via the
  // index-backed objectId column. Returns [] on empty input without touching the DB (In([]) would
  // otherwise build a pointless `IN (NULL)` query).
  async getByObjectIds(objectIds: string[]): Promise<ScorechainScreening[]> {
    if (!objectIds.length) return [];

    return this.find({ where: { objectId: In(objectIds) }, order: { created: 'DESC' } });
  }
}
