import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { StepLog } from '../entities/step-log.entity';

@Injectable()
export class MergeLogRepository extends BaseRepository<StepLog> {
  constructor(manager: EntityManager) {
    super(StepLog, manager);
  }
}
