import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { JobAttempt } from '../entities/job-attempt.entity';

@Injectable()
export class JobAttemptRepository extends BaseRepository<JobAttempt> {
  constructor(manager: EntityManager) {
    super(JobAttempt, manager);
  }
}
