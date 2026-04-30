import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { BuyCryptoBatch } from '../entities/buy-crypto-batch.entity';

@Injectable()
export class BuyCryptoBatchRepository extends BaseRepository<BuyCryptoBatch> {
  constructor(manager: EntityManager) {
    super(BuyCryptoBatch, manager);
  }
}
