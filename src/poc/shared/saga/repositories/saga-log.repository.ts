import { EntityRepository, Repository } from 'typeorm';
import { PocSagaLog } from '../entities/saga-log.entity';

@EntityRepository(PocSagaLog)
export class PocSagaLogRepository extends Repository<PocSagaLog> {}
