import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { SiftErrorLog } from '../entities/sift-error-log.entity';

@Injectable()
export class SiftErrorLogRepository extends BaseRepository<SiftErrorLog> {
  constructor(manager: EntityManager) {
    super(SiftErrorLog, manager);
  }
}
