import { EntityRepository, Repository } from 'typeorm';
import { SystemStateSnapshot } from './system-state-snapshot.entity';

@EntityRepository(SystemStateSnapshot)
export class SystemStateSnapshotRepository extends Repository<SystemStateSnapshot> {}
