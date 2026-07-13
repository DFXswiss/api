import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { ArchiveBatch } from './archive-batch.entity';

@Injectable()
export class ArchiveBatchRepository extends BaseRepository<ArchiveBatch> {
  constructor(manager: EntityManager) {
    super(ArchiveBatch, manager);
  }
}
