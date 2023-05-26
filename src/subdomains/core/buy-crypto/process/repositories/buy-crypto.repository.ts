import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager, UpdateResult } from 'typeorm';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { BuyCryptoFee } from '../entities/buy-crypto-fees.entity';

@Injectable()
export class BuyCryptoRepository extends BaseRepository<BuyCrypto> {
  constructor(manager: EntityManager) {
    super(BuyCrypto, manager);
  }

  async updateFee(id: number, update: Partial<BuyCryptoFee>): Promise<UpdateResult> {
    return this.manager.update(BuyCryptoFee, id, update);
  }
}
