import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { SupportIssueLog } from '../entities/support-issue-log.entity';

@Injectable()
export class SupportIssueLogRepository extends BaseRepository<SupportIssueLog> {
  constructor(manager: EntityManager) {
    super(SupportIssueLog, manager);
  }
}
