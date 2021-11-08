import { EntityRepository, Repository } from 'typeorm';
import { FiatInputBatch } from './fiat-input-batch.entity';

@EntityRepository(FiatInputBatch)
export class FiatInputBatchRepository extends Repository<FiatInputBatch> {}
