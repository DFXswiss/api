import { EntityRepository, Repository } from 'typeorm';
import { SystemStateRecord } from './system-state.entity';

@EntityRepository(SystemStateRecord)
export class SystemStateRepository extends Repository<SystemStateRecord> {}
