import { EntityRepository, Repository } from 'typeorm';
import { SystemState } from './system-state.entity';

@EntityRepository(SystemState)
export class SystemStateRepository extends Repository<SystemState> {}
