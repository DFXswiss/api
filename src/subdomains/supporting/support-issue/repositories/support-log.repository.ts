import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { SupportLog } from '../entities/support-log.entity';

@Injectable()
export class SupportLogRepository extends BaseRepository<SupportLog> {
  constructor(manager: EntityManager) {
    super(SupportLog, manager);
  }
}
