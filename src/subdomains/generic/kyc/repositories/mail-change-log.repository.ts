import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { MailChangeLog } from '../entities/mail-change-log.entity';

@Injectable()
export class MailChangeLogRepository extends BaseRepository<MailChangeLog> {
  constructor(manager: EntityManager) {
    super(MailChangeLog, manager);
  }
}
