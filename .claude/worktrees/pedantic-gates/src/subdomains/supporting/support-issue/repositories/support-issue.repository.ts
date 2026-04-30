import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { SupportIssue } from '../entities/support-issue.entity';

@Injectable()
export class SupportIssueRepository extends BaseRepository<SupportIssue> {
  constructor(manager: EntityManager) {
    super(SupportIssue, manager);
  }
}
