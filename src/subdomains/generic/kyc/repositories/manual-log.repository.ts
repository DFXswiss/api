import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { ManualLog } from '../entities/manual-log.entity';

@Injectable()
export class ManualLogRepository extends BaseRepository<ManualLog> {
  constructor(manager: EntityManager) {
    super(ManualLog, manager);
  }
}
