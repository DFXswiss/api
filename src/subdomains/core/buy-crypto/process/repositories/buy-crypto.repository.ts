import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { BuyCrypto } from '../entities/buy-crypto.entity';

@Injectable()
export class BuyCryptoRepository extends BaseRepository<BuyCrypto> {
  constructor(manager: EntityManager) {
    super(BuyCrypto, manager);
  }
}
