import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { NameCheckLog } from '../entities/name-check-log.entity';

@Injectable()
export class NameCheckLogRepository extends BaseRepository<NameCheckLog> {
  constructor(manager: EntityManager) {
    super(NameCheckLog, manager);
  }
}
