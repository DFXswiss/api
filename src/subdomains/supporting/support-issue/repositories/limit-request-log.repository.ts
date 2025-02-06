import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { LimitRequestLog } from '../entities/limit-request-log.entity';

@Injectable()
export class LimitRequestLogRepository extends BaseRepository<LimitRequestLog> {
  constructor(manager: EntityManager) {
    super(LimitRequestLog, manager);
  }
}
