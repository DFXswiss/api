import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { MergeLog } from '../entities/merge-log.entity';

@Injectable()
export class MergeLogRepository extends BaseRepository<MergeLog> {
  constructor(manager: EntityManager) {
    super(MergeLog, manager);
  }
}
