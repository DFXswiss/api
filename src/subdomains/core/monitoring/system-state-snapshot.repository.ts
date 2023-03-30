import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { SystemStateSnapshot } from './system-state-snapshot.entity';

@Injectable()
export class SystemStateSnapshotRepository extends BaseRepository<SystemStateSnapshot> {
  constructor(manager: EntityManager) {
    super(SystemStateSnapshot, manager);
  }
}
