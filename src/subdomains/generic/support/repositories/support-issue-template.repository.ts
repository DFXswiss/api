import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { SupportIssueTemplate } from '../entities/support-issue-template.entity';

@Injectable()
export class SupportIssueTemplateRepository extends BaseRepository<SupportIssueTemplate> {
  constructor(manager: EntityManager) {
    super(SupportIssueTemplate, manager);
  }
}
