import { EntityRepository, Repository } from 'typeorm';
import { PocSaga } from '../entities/saga.entity';

@EntityRepository(PocSaga)
export class PocSagaRepository extends Repository<PocSaga> {}
