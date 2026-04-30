import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { BuyFiat } from './buy-fiat.entity';

@Injectable()
export class BuyFiatRepository extends BaseRepository<BuyFiat> {
  constructor(manager: EntityManager) {
    super(BuyFiat, manager);
  }
}
