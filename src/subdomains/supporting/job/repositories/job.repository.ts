import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Job } from '../entities/job.entity';

@Injectable()
export class JobRepository extends BaseRepository<Job> {
  constructor(manager: EntityManager) {
    super(Job, manager);
  }
}
