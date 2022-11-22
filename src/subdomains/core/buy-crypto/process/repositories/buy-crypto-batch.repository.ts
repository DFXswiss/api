import { EntityRepository, Repository } from 'typeorm';
import { BuyCryptoBatch } from '../entities/buy-crypto-batch.entity';

@EntityRepository(BuyCryptoBatch)
export class BuyCryptoBatchRepository extends Repository<BuyCryptoBatch> {}
